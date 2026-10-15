import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { CostEstimate, CostEstimateRequest, Material } from '@print3d/api-contracts';
import {
  catchError,
  EMPTY,
  map,
  type Observable,
  of,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import {
  basisPointsToPercentInput,
  formatMoney,
  formatPercent,
  MATERIAL_LABELS,
  parsePercentToBasisPoints,
  WARNING_MESSAGES,
} from './cost-labels';
import { CostsApi } from './costs-api';
import {
  type PickerCatalogue,
  type PickerFilament,
  type PickerPart,
  type PickerPrinter,
  CostsPickersApi,
} from './costs-pickers-api';

type CatalogueState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly items: readonly T[]; readonly truncated: boolean }
  | { readonly kind: 'failed'; readonly message: string };

/** Spools wait (`idle`) until a part is chosen, because they depend on its material. */
type SpoolState = CatalogueState<PickerFilament> | { readonly kind: 'idle' };

type ResultState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'calculating' }
  | { readonly kind: 'done'; readonly estimate: CostEstimate; readonly sale: boolean }
  | { readonly kind: 'failed'; readonly message: string };

type FieldKey = 'part' | 'quantity' | 'spool' | 'printer' | 'margin';

/** Top-to-bottom order, used to move focus to the first invalid field. */
const FIELD_ORDER: readonly FieldKey[] = ['part', 'quantity', 'spool', 'printer', 'margin'];

const FOCUS_TARGET: Readonly<Record<FieldKey, string>> = {
  part: 'field-part',
  quantity: 'field-quantity',
  spool: 'field-spool',
  printer: 'field-printer',
  margin: 'field-margin',
};

/** Which control an API issue path belongs to. Unknown paths map to nothing. */
const ISSUE_FIELD: Readonly<Record<string, FieldKey>> = {
  partId: 'part',
  quantity: 'quantity',
  filamentId: 'spool',
  printerId: 'printer',
  marginBasisPoints: 'margin',
};

const VALIDATION_MESSAGES: Readonly<Record<FieldKey, string>> = {
  part: 'Elegí una pieza.',
  quantity: 'Ingresá una cantidad entera entre 1 y 1000.',
  spool: 'Elegí una bobina.',
  printer: 'La impresora no es válida.',
  margin: 'Ingresá solo números, con hasta 2 decimales, entre 0 y 1000.',
};

const SERVER_REJECTED: Readonly<Record<FieldKey, string>> = {
  part: 'La pieza elegida ya no existe o no es válida.',
  quantity: 'La cantidad no es válida o el resultado es demasiado grande.',
  spool: 'La bobina elegida no existe o su material no coincide con el de la pieza.',
  printer: 'La impresora elegida ya no existe.',
  margin: 'El margen no es válido.',
};

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 1000;
const LOADING: { readonly kind: 'loading' } = { kind: 'loading' };

const GRAMS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function quantityValidator(control: AbstractControl): ValidationErrors | null {
  const value: unknown = control.value;
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_QUANTITY &&
    value <= MAX_QUANTITY
    ? null
    : { range: true };
}

function requiredText(control: AbstractControl<string>): ValidationErrors | null {
  return control.value === '' ? { required: true } : null;
}

/** The catalogue as a view state; a failure carries a Spanish message that is safe to show. */
function toCatalogueState<T>(catalogue: PickerCatalogue<T>): CatalogueState<T> {
  return { kind: 'ready', items: catalogue.items, truncated: catalogue.truncated };
}

function failedState(error: unknown): { readonly kind: 'failed'; readonly message: string } {
  return { kind: 'failed', message: error instanceof ApiError ? error.message : GENERIC_ERROR };
}

@Component({
  selector: 'app-cost-estimate-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './cost-estimate-page.html',
  styleUrl: './cost-estimate-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostEstimatePage {
  private readonly api = inject(CostsApi);
  private readonly pickers = inject(CostsPickersApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);
  /** `?piezaId=` preselects a part (the link on the parts list). Anything unknown is ignored. */
  private readonly requestedPartId = inject(ActivatedRoute).snapshot.queryParamMap.get('piezaId');

  protected readonly maxQuantity = MAX_QUANTITY;

  // Declared before the form: the margin validator reads it.
  private readonly sale = this.fb.control(false);

  protected readonly form = this.fb.group({
    partId: this.fb.control('', requiredText),
    quantity: this.fb.control<number | null>(1, quantityValidator),
    filamentId: this.fb.control('', requiredText),
    printerId: this.fb.control(''),
    sale: this.sale,
    margin: this.fb.control('', (control: AbstractControl<string>) =>
      this.sale.value && parsePercentToBasisPoints(control.value) === null
        ? { invalid: true }
        : null,
    ),
  });

  protected readonly submitted = signal(false);

  private readonly partsRetry = new Subject<void>();
  private readonly printersRetry = new Subject<void>();
  private readonly spoolsAttempt = signal(0);
  private readonly estimateRequests = new Subject<CostEstimateRequest | null>();

  // Views of control values for the template and for the spool lookup.
  protected readonly partId = toSignal(this.form.controls.partId.valueChanges, {
    initialValue: this.form.controls.partId.value,
  });
  protected readonly isSale = toSignal(this.sale.valueChanges, { initialValue: false });

  protected readonly parts = toSignal(
    this.partsRetry.pipe(
      startWith(undefined),
      switchMap(() =>
        this.pickers.parts().pipe(
          map((catalogue): CatalogueState<PickerPart> => {
            this.preselectRequestedPart(catalogue.items);
            return toCatalogueState(catalogue);
          }),
          catchError((error: unknown) => of<CatalogueState<PickerPart>>(failedState(error))),
          startWith<CatalogueState<PickerPart>>(LOADING),
        ),
      ),
    ),
    { initialValue: LOADING },
  );

  protected readonly printers = toSignal(
    this.printersRetry.pipe(
      startWith(undefined),
      switchMap(() =>
        this.pickers.printers().pipe(
          map((catalogue): CatalogueState<PickerPrinter> => toCatalogueState(catalogue)),
          catchError((error: unknown) => of<CatalogueState<PickerPrinter>>(failedState(error))),
          startWith<CatalogueState<PickerPrinter>>(LOADING),
        ),
      ),
    ),
    { initialValue: LOADING },
  );

  /** Spools of the chosen part's material; null until a part is chosen. */
  protected readonly material = computed((): Material | null => {
    const parts = this.parts();
    if (parts.kind !== 'ready') return null;
    return parts.items.find((part) => part.id === this.partId())?.material ?? null;
  });

  protected readonly materialLabel = computed(() => {
    const material = this.material();
    return material === null ? '' : MATERIAL_LABELS[material];
  });

  protected readonly spools = toSignal(
    toObservable(
      computed(() => ({ material: this.material(), attempt: this.spoolsAttempt() })),
    ).pipe(
      tap(() => {
        this.form.controls.filamentId.setValue('');
      }),
      switchMap(({ material }): Observable<SpoolState> => {
        if (material === null) return of<SpoolState>({ kind: 'idle' });
        return this.pickers.filaments(material).pipe(
          map((catalogue): SpoolState => {
            const [only] = catalogue.items;
            // One spool only: nothing to decide, so it is chosen for the user.
            if (catalogue.items.length === 1 && only !== undefined) {
              this.form.controls.filamentId.setValue(only.id);
            }
            return toCatalogueState(catalogue);
          }),
          catchError((error: unknown) => of<SpoolState>(failedState(error))),
          startWith<SpoolState>(LOADING),
        );
      }),
    ),
    { initialValue: { kind: 'idle' } },
  );

  protected readonly result = toSignal(
    this.estimateRequests.pipe(
      // `switchMap` cancels a request in flight when an input changes (`null`).
      switchMap((request) => {
        if (request === null) return of<ResultState>({ kind: 'idle' });
        return this.api.estimate(request).pipe(
          map((estimate): ResultState => ({
            kind: 'done',
            estimate,
            sale: request.marginBasisPoints !== undefined,
          })),
          catchError((error: unknown) => of<ResultState>(this.failureOf(error))),
          startWith<ResultState>({ kind: 'calculating' }),
        );
      }),
    ),
    { initialValue: { kind: 'idle' } },
  );

  constructor() {
    // The default margin only pre-fills the field for a sale; the API never applies it itself.
    // If the settings cannot be read the field stays empty and the user types the margin.
    this.api
      .getSettings()
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((settings) => {
        const margin = this.form.controls.margin;
        if (margin.dirty) return;
        margin.setValue(basisPointsToPercentInput(settings.defaultMarginBasisPoints), {
          emitEvent: false,
        });
      });
    this.sale.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.form.controls.margin.updateValueAndValidity({ emitEvent: false });
    });
    // Any input change invalidates what was calculated.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.estimateRequests.next(null);
    });
  }

  protected errorFor(field: FieldKey): string | null {
    const control = this.control(field);
    const errors = control.errors;
    if (errors === null || !(control.dirty || control.touched || this.submitted())) return null;
    return errors['server'] ? SERVER_REJECTED[field] : VALIDATION_MESSAGES[field];
  }

  protected spoolLabel(spool: PickerFilament): string {
    const base = `${spool.brand} · ${spool.colorName} · ${GRAMS.format(spool.availableGrams)} g disponibles`;
    return spool.availableGrams === 0 ? `${base} · Sin stock` : base;
  }

  protected materialLabelOf = (material: Material): string => MATERIAL_LABELS[material];
  protected formatMoney = formatMoney;
  protected formatPercent = formatPercent;
  protected formatGrams = (grams: number): string => GRAMS.format(grams);
  protected warningText = (code: keyof typeof WARNING_MESSAGES): string => WARNING_MESSAGES[code];

  protected retryParts(): void {
    this.partsRetry.next();
  }

  protected retryPrinters(): void {
    this.printersRetry.next();
  }

  protected retrySpools(): void {
    this.spoolsAttempt.update((attempt) => attempt + 1);
  }

  protected submit(): void {
    if (this.result().kind === 'calculating') return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const raw = this.form.getRawValue();
    const margin = raw.sale ? parsePercentToBasisPoints(raw.margin) : null;
    if (this.form.invalid || raw.quantity === null || (raw.sale && margin === null)) {
      this.focusFirstInvalid();
      return;
    }

    this.estimateRequests.next({
      partId: raw.partId,
      filamentId: raw.filamentId,
      quantity: raw.quantity,
      ...(raw.printerId === '' ? {} : { printerId: raw.printerId }),
      // No margin unless "¿Venta?" is checked: the default margin is never applied silently.
      ...(margin === null ? {} : { marginBasisPoints: margin }),
    });
  }

  private control(field: FieldKey): AbstractControl {
    const controls = this.form.controls;
    return {
      part: controls.partId,
      quantity: controls.quantity,
      spool: controls.filamentId,
      printer: controls.printerId,
      margin: controls.margin,
    }[field];
  }

  private failureOf(error: unknown): ResultState {
    if (!(error instanceof ApiError)) return { kind: 'failed', message: GENERIC_ERROR };
    if (error.status === 400) {
      const fields = new Set<FieldKey>();
      for (const issue of error.issues) {
        const field = ISSUE_FIELD[issue.path];
        if (field !== undefined) fields.add(field);
      }
      if (fields.size > 0) {
        for (const field of fields) this.control(field).setErrors({ server: true });
        this.focusFirstInvalid();
        return { kind: 'failed', message: 'Revisá los datos marcados e intentá de nuevo.' };
      }
    }
    return { kind: 'failed', message: error.message };
  }

  private preselectRequestedPart(parts: readonly PickerPart[]): void {
    const control = this.form.controls.partId;
    if (this.requestedPartId === null || control.value !== '') return;
    if (parts.some((part) => part.id === this.requestedPartId)) {
      control.setValue(this.requestedPartId);
    }
  }

  private focusFirstInvalid(): void {
    const first = FIELD_ORDER.find((field) => this.control(field).invalid);
    if (first !== undefined) {
      this.host.nativeElement.querySelector<HTMLElement>(`#${FOCUS_TARGET[first]}`)?.focus();
    }
  }
}
