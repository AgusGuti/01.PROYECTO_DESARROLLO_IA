import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  CreateFilamentRequest,
  Filament,
  Material,
  UpdateFilamentRequest,
} from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import {
  formatDate,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  minorToPesosInput,
  parsePesosToMinor,
  parseDate,
  todayUtc,
} from './filament-labels';
import { FilamentsApi } from './filaments-api';
import { type FilamentsNotice, noticeState } from './filaments-notice';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly filament: Filament | null }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'failed'; readonly message: string };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** `stale` means someone else saved first: the page offers to reload. */
  | { readonly kind: 'failed'; readonly message: string; readonly stale: boolean };

type FieldKey =
  | 'brand'
  | 'material'
  | 'colorName'
  | 'initialGrams'
  | 'availableGrams'
  | 'purchaseCost'
  | 'purchaseDate';

/** Top-to-bottom order, used to move focus to the first invalid field. */
const FIELD_ORDER: readonly FieldKey[] = [
  'brand',
  'material',
  'colorName',
  'initialGrams',
  'availableGrams',
  'purchaseCost',
  'purchaseDate',
];

const FOCUS_TARGET: Readonly<Record<FieldKey, string>> = {
  brand: 'field-brand',
  material: 'field-material',
  colorName: 'field-color',
  initialGrams: 'field-initial-grams',
  availableGrams: 'field-available-grams',
  purchaseCost: 'field-cost',
  purchaseDate: 'field-date',
};

/** Which control an API issue path belongs to. Unknown paths map to nothing. */
const ISSUE_FIELD: Readonly<Record<string, FieldKey>> = {
  brand: 'brand',
  material: 'material',
  colorName: 'colorName',
  initialGrams: 'initialGrams',
  availableGrams: 'availableGrams',
  purchaseCostMinor: 'purchaseCost',
  purchaseDate: 'purchaseDate',
};

const SERVER_REJECTED: Readonly<Record<FieldKey, string>> = {
  brand: 'La marca no es válida.',
  material: 'El material no es válido.',
  colorName: 'El color no es válido.',
  initialGrams: 'El peso inicial no es válido.',
  availableGrams: 'Los gramos disponibles no son válidos.',
  purchaseCost: 'El costo no es válido.',
  purchaseDate: 'La fecha de compra no es válida.',
};

const MAX_BRAND_LENGTH = 60;
const MAX_COLOR_LENGTH = 40;
const MAX_GRAMS = 20_000;
const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const INITIAL_LOAD: LoadState = { kind: 'loading' };

/** Message for each field's own client-side validation errors. */
const VALIDATION_MESSAGES: Readonly<Record<FieldKey, (errors: ValidationErrors) => string>> = {
  brand: (errors) =>
    errors['maxlength']
      ? `La marca puede tener hasta ${String(MAX_BRAND_LENGTH)} caracteres.`
      : 'Ingresá la marca.',
  material: () => SERVER_REJECTED.material,
  colorName: (errors) =>
    errors['maxlength']
      ? `El color puede tener hasta ${String(MAX_COLOR_LENGTH)} caracteres.`
      : 'Ingresá el color.',
  initialGrams: () => `Ingresá un número entero entre 1 y ${String(MAX_GRAMS)}.`,
  availableGrams: (errors) =>
    errors['exceeds']
      ? 'Los gramos disponibles no pueden superar el peso inicial.'
      : `Ingresá un número entero entre 0 y ${String(MAX_GRAMS)}.`,
  purchaseCost: () =>
    'Ingresá el costo en pesos, con coma para los centavos (por ejemplo 15000 o 15000,50). Sin separador de miles.',
  purchaseDate: () => 'Ingresá una fecha de compra válida que no sea posterior a hoy.',
};

// Client validation mirrors the API limits. It is a convenience: the server decides.
function textValidator(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const length = Array.from(String(control.value).trim()).length;
    if (length === 0) return { required: true };
    return length > max ? { maxlength: true } : null;
  };
}

function wholeNumberBetween(min: number, max: number, optional: boolean): ValidatorFn {
  return (control) => {
    const value: unknown = control.value;
    if (value === null || value === '') return optional ? null : { required: true };
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? null
      : { range: true };
  };
}

/** On create an empty field means "same as the initial weight"; on edit it is required. */
function availableValidator(optional: boolean): ValidatorFn {
  const inRange = wholeNumberBetween(0, MAX_GRAMS, optional);
  return (control) => {
    const base = inRange(control);
    if (base !== null) return base;
    const initial: unknown = control.parent?.get('initialGrams')?.value;
    const value: unknown = control.value;
    return typeof value === 'number' && typeof initial === 'number' && value > initial
      ? { exceeds: true }
      : null;
  };
}

function costValidator(control: AbstractControl<string>): ValidationErrors | null {
  return parsePesosToMinor(control.value) === null ? { format: true } : null;
}

function dateValidator(today: string): ValidatorFn {
  return (control) => {
    const value: unknown = control.value;
    const iso = typeof value === 'string' ? parseDate(value) : null;
    return iso !== null && iso <= today ? null : { date: true };
  };
}

function hasPath(error: ApiError, path: string): boolean {
  return error.issues.some((issue) => issue.path === path);
}

interface FormValues {
  readonly brand: string;
  readonly material: Material;
  readonly colorName: string;
  readonly initialGrams: number;
  /** Null only on create, when the field was left empty. */
  readonly availableGrams: number | null;
  readonly purchaseCostMinor: number;
  readonly purchaseDate: string;
}

@Component({
  selector: 'app-filament-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './filament-form-page.html',
  styleUrl: './filament-form-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilamentFormPage {
  private readonly api = inject(FilamentsApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);

  /** `null` on /filamentos/nuevo, the filament id on /filamentos/:id/editar. */
  protected readonly filamentId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  /** The latest purchase date the API accepts (UTC today, ADR 0011). */
  protected readonly today = todayUtc();

  protected readonly materialOptions = MATERIAL_ORDER.map((value) => ({
    value,
    label: MATERIAL_LABELS[value],
  }));

  protected readonly form = this.fb.group({
    brand: this.fb.control('', textValidator(MAX_BRAND_LENGTH)),
    material: this.fb.control<Material>('PLA'),
    colorName: this.fb.control('', textValidator(MAX_COLOR_LENGTH)),
    initialGrams: this.fb.control<number | null>(null, wholeNumberBetween(1, MAX_GRAMS, false)),
    availableGrams: this.fb.control<number | null>(
      null,
      availableValidator(this.filamentId === null),
    ),
    purchaseCost: this.fb.control('', costValidator),
    purchaseDate: this.fb.control('', dateValidator(this.today)),
  });

  protected readonly submitted = signal(false);
  protected readonly save = signal<SaveState>({ kind: 'idle' });

  private readonly loadRequests = new Subject<void>();

  /** Create: ready at once. Edit: loads the filament; `switchMap` drops superseded loads. */
  protected readonly load = toSignal(
    this.loadRequests.pipe(
      startWith(undefined),
      switchMap(() => {
        const id = this.filamentId;
        if (id === null) return of<LoadState>({ kind: 'ready', filament: null });
        return this.api.get(id).pipe(
          map((filament): LoadState => {
            this.populate(filament);
            return { kind: 'ready', filament };
          }),
          catchError((error: unknown) =>
            of<LoadState>(
              error instanceof ApiError && error.status === 404
                ? { kind: 'notFound' }
                : {
                    kind: 'failed',
                    message: error instanceof ApiError ? error.message : GENERIC_ERROR,
                  },
            ),
          ),
          startWith<LoadState>({ kind: 'loading' }),
        );
      }),
    ),
    { initialValue: INITIAL_LOAD },
  );

  constructor() {
    // "Available <= initial" involves two controls: check it again when the initial one changes.
    this.form.controls.initialGrams.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.form.controls.availableGrams.updateValueAndValidity({ emitEvent: false });
      });
  }

  /** The visible error for a field, or null. Shown once the user touched it or tried to save. */
  protected errorFor(field: FieldKey): string | null {
    const control = this.form.controls[field];
    const errors = control.errors;
    if (errors === null || !(control.touched || this.submitted())) return null;
    if (errors['server']) return SERVER_REJECTED[field];
    return VALIDATION_MESSAGES[field](errors);
  }

  /** Ids of the hint and error paragraphs that currently exist, for `aria-describedby`. */
  protected describedBy(field: FieldKey, hintId: string | null): string | null {
    const ids = [
      ...(hintId === null ? [] : [hintId]),
      ...(this.errorFor(field) === null ? [] : [`${FOCUS_TARGET[field]}-error`]),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  }

  protected submit(): void {
    if (this.save().kind === 'saving') return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const loaded = this.load();
    const values = this.readValues();
    if (this.form.invalid || values === null || loaded.kind !== 'ready') {
      this.focusFirstInvalid();
      return;
    }

    const filament = loaded.filament;
    if (filament === null) {
      const body: CreateFilamentRequest = {
        brand: values.brand,
        material: values.material,
        colorName: values.colorName,
        initialGrams: values.initialGrams,
        // Empty means "a new spool": the API fills in the initial weight.
        ...(values.availableGrams === null ? {} : { availableGrams: values.availableGrams }),
        purchaseCostMinor: values.purchaseCostMinor,
        purchaseDate: values.purchaseDate,
      };
      this.send(this.api.create(body), 'created');
      return;
    }

    const body = this.changesFrom(filament, values);
    if (Object.keys(body).length === 1) {
      // Nothing changed: there is nothing to send (the API rejects an empty patch).
      void this.router.navigate(['/filamentos']);
      return;
    }
    this.send(this.api.update(filament.id, body), 'updated');
  }

  protected reload(): void {
    this.save.set({ kind: 'idle' });
    this.loadRequests.next();
  }

  private send(request: ReturnType<FilamentsApi['create']>, notice: FilamentsNotice): void {
    this.save.set({ kind: 'saving' });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        void this.router.navigate(['/filamentos'], { state: noticeState(notice) });
      },
      error: (error: unknown) => {
        this.handleSaveError(error);
      },
    });
  }

  private handleSaveError(error: unknown): void {
    if (!(error instanceof ApiError)) {
      this.save.set({ kind: 'failed', message: GENERIC_ERROR, stale: false });
      return;
    }

    if (error.status === 404 && this.filamentId !== null) {
      void this.router.navigate(['/filamentos'], { state: noticeState('gone') });
      return;
    }

    if (error.status === 409) {
      this.save.set(
        hasPath(error, 'version')
          ? {
              kind: 'failed',
              stale: true,
              message:
                'Alguien modificó este filamento mientras lo editabas (también pasa si se descontó material). Recargalo para ver los cambios actuales; tus cambios sin guardar se van a perder.',
            }
          : {
              kind: 'failed',
              stale: false,
              message:
                'No se pudo guardar por un conflicto con otros datos. Revisalos e intentá de nuevo.',
            },
      );
      return;
    }

    const fields = new Set<FieldKey>();
    if (error.status === 400) {
      for (const issue of error.issues) {
        const field = ISSUE_FIELD[issue.path];
        if (field !== undefined) fields.add(field);
      }
    }
    if (fields.size > 0) {
      this.save.set({ kind: 'idle' });
      for (const field of fields) this.form.controls[field].setErrors({ server: true });
      this.focusFirstInvalid();
      return;
    }
    this.save.set({ kind: 'failed', message: error.message, stale: false });
  }

  private populate(filament: Filament): void {
    this.form.reset({
      brand: filament.brand,
      material: filament.material,
      colorName: filament.colorName,
      initialGrams: filament.initialGrams,
      availableGrams: filament.availableGrams,
      purchaseCost: minorToPesosInput(filament.purchaseCostMinor),
      purchaseDate: formatDate(filament.purchaseDate),
    });
    this.submitted.set(false);
  }

  private readValues(): FormValues | null {
    const raw = this.form.getRawValue();
    const purchaseCostMinor = parsePesosToMinor(raw.purchaseCost);
    if (raw.initialGrams === null || purchaseCostMinor === null) return null;
    return {
      brand: raw.brand.trim(),
      material: raw.material,
      colorName: raw.colorName.trim(),
      initialGrams: raw.initialGrams,
      availableGrams: raw.availableGrams,
      purchaseCostMinor,
      purchaseDate: parseDate(raw.purchaseDate) ?? '',
    };
  }

  /** Only what changed, plus the version the user loaded (ADR 0008). */
  private changesFrom(filament: Filament, values: FormValues): UpdateFilamentRequest {
    return {
      version: filament.version,
      ...(values.brand === filament.brand ? {} : { brand: values.brand }),
      ...(values.material === filament.material ? {} : { material: values.material }),
      ...(values.colorName === filament.colorName ? {} : { colorName: values.colorName }),
      ...(values.initialGrams === filament.initialGrams
        ? {}
        : { initialGrams: values.initialGrams }),
      ...(values.availableGrams === null || values.availableGrams === filament.availableGrams
        ? {}
        : { availableGrams: values.availableGrams }),
      ...(values.purchaseCostMinor === filament.purchaseCostMinor
        ? {}
        : { purchaseCostMinor: values.purchaseCostMinor }),
      ...(values.purchaseDate === filament.purchaseDate
        ? {}
        : { purchaseDate: values.purchaseDate }),
    };
  }

  private focusFirstInvalid(): void {
    const first = FIELD_ORDER.find((field) => this.form.controls[field].invalid);
    if (first === undefined) return;
    this.host.nativeElement.querySelector<HTMLElement>(`#${FOCUS_TARGET[first]}`)?.focus();
  }
}
