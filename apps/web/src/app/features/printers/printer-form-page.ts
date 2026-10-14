import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
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
  CreatePrinterRequest,
  Material,
  Printer,
  PrinterNozzle,
  PrinterStatus,
  UpdatePrinterRequest,
} from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { PrinterRestoreDialog } from './printer-restore-dialog';
import {
  formatDiameter,
  isReinforcedMaterial,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  NOZZLE_DIAMETERS_MM,
  NOZZLE_MATERIAL_LABELS,
  NOZZLE_MATERIAL_ORDER,
  type NozzleDiameter,
  type NozzleMaterial,
  STATUS_LABELS,
  STATUS_ORDER,
} from './printer-labels';
import { PrintersApi } from './printers-api';
import { noticeState, type PrintersNotice } from './printers-notice';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly printer: Printer | null }
  | { readonly kind: 'archived' }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'failed'; readonly message: string };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** `stale` means someone else saved first: the page offers to reload. */
  | { readonly kind: 'failed'; readonly message: string; readonly stale: boolean };

type FieldKey =
  'name' | 'x' | 'y' | 'z' | 'diameterMm' | 'nozzleMaterial' | 'materials' | 'speed' | 'status';

/** Top-to-bottom order, used to move focus to the first invalid field. */
const FIELD_ORDER: readonly FieldKey[] = [
  'name',
  'x',
  'y',
  'z',
  'diameterMm',
  'nozzleMaterial',
  'materials',
  'speed',
  'status',
];

const FOCUS_TARGET: Readonly<Record<FieldKey, string>> = {
  name: 'field-name',
  x: 'field-x',
  y: 'field-y',
  z: 'field-z',
  diameterMm: 'field-diameter',
  nozzleMaterial: 'field-nozzle-material',
  materials: `material-${MATERIAL_ORDER[0] ?? 'PLA'}`,
  speed: 'field-speed',
  status: 'field-status',
};

/** Which control an API issue path belongs to. Unknown paths map to nothing. */
const ISSUE_FIELD: Readonly<Record<string, FieldKey>> = {
  name: 'name',
  'buildVolume.x': 'x',
  'buildVolume.y': 'y',
  'buildVolume.z': 'z',
  'nozzle.diameterMm': 'diameterMm',
  'nozzle.material': 'nozzleMaterial',
  compatibleMaterials: 'materials',
  typicalSpeedMmS: 'speed',
  status: 'status',
};

const SERVER_REJECTED: Readonly<Record<FieldKey, string>> = {
  name: 'El nombre no es válido.',
  x: 'El ancho no es válido.',
  y: 'El fondo no es válido.',
  z: 'El alto no es válido.',
  diameterMm: 'El diámetro de la boquilla no es válido.',
  nozzleMaterial: 'El material de la boquilla no es válido.',
  materials: 'Los materiales elegidos no son compatibles con esta boquilla. Revisá la selección.',
  speed: 'La velocidad no es válida.',
  status: 'El estado no es válido.',
};

const MAX_NAME_LENGTH = 100;
const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const INITIAL_LOAD: LoadState = { kind: 'loading' };

const DIMENSION_MESSAGE = 'Ingresá un número entero entre 1 y 2000.';

/** Message for each field's own client-side validation errors. */
const VALIDATION_MESSAGES: Readonly<Record<FieldKey, (errors: ValidationErrors) => string>> = {
  name: (errors) =>
    errors['maxlength']
      ? `El nombre puede tener hasta ${String(MAX_NAME_LENGTH)} caracteres.`
      : 'Ingresá el nombre de la impresora.',
  x: () => DIMENSION_MESSAGE,
  y: () => DIMENSION_MESSAGE,
  z: () => DIMENSION_MESSAGE,
  diameterMm: () => SERVER_REJECTED.diameterMm,
  nozzleMaterial: () => SERVER_REJECTED.nozzleMaterial,
  materials: () => 'Elegí al menos un material.',
  speed: () => 'Ingresá un número entero entre 1 y 1000, o dejalo vacío.',
  status: () => SERVER_REJECTED.status,
};

function atLeastOne(control: AbstractControl<Material[]>): ValidationErrors | null {
  return control.value.length === 0 ? { required: true } : null;
}

// Client validation mirrors the API limits. It is a convenience: the server decides.
function nameValidator(control: AbstractControl<string>): ValidationErrors | null {
  const length = Array.from(control.value.trim()).length;
  if (length === 0) return { required: true };
  return length > MAX_NAME_LENGTH ? { maxlength: true } : null;
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

function hasPath(error: ApiError, path: string): boolean {
  return error.issues.some((issue) => issue.path === path);
}

function sameMembers(a: readonly Material[], b: readonly Material[]): boolean {
  return a.length === b.length && a.every((material) => b.includes(material));
}

@Component({
  selector: 'app-printer-form-page',
  imports: [ReactiveFormsModule, RouterLink, PrinterRestoreDialog],
  templateUrl: './printer-form-page.html',
  styleUrl: './printer-form-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrinterFormPage {
  private readonly api = inject(PrintersApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly injector = inject(Injector);

  /** `null` on /impresoras/nueva, the printer id on /impresoras/:id/editar. */
  protected readonly printerId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  protected readonly materialOptions = MATERIAL_ORDER.map((value) => ({
    value,
    label: MATERIAL_LABELS[value],
    reinforced: isReinforcedMaterial(value),
  }));
  protected readonly nozzleMaterialOptions = NOZZLE_MATERIAL_ORDER.map((value) => ({
    value,
    label: NOZZLE_MATERIAL_LABELS[value],
  }));
  protected readonly statusOptions = STATUS_ORDER.map((value) => ({
    value,
    label: STATUS_LABELS[value],
  }));
  protected readonly diameterOptions = NOZZLE_DIAMETERS_MM.map((value) => ({
    value,
    label: formatDiameter(value),
  }));

  protected readonly form = this.fb.group({
    name: this.fb.control('', nameValidator),
    x: this.fb.control<number | null>(null, wholeNumberBetween(1, 2000, false)),
    y: this.fb.control<number | null>(null, wholeNumberBetween(1, 2000, false)),
    z: this.fb.control<number | null>(null, wholeNumberBetween(1, 2000, false)),
    diameterMm: this.fb.control<NozzleDiameter>(0.4),
    nozzleMaterial: this.fb.control<NozzleMaterial>('brass'),
    materials: this.fb.control<Material[]>([], atLeastOne),
    speed: this.fb.control<number | null>(null, wholeNumberBetween(1, 1000, true)),
    status: this.fb.control<PrinterStatus>('available'),
  });

  // Views of control values for the template (checkbox state, disabled options).
  protected readonly nozzleMaterial = toSignal(this.form.controls.nozzleMaterial.valueChanges, {
    initialValue: this.form.controls.nozzleMaterial.value,
  });
  protected readonly selectedMaterials = toSignal(this.form.controls.materials.valueChanges, {
    initialValue: this.form.controls.materials.value,
  });

  protected readonly submitted = signal(false);
  protected readonly fibreMaterialsRemoved = signal(false);
  protected readonly save = signal<SaveState>({ kind: 'idle' });
  /** Set while the "restore the deleted printer?" dialog is open. */
  protected readonly restorePrompt = signal<{ readonly name: string } | null>(null);
  /** Shown under the name after the user declined to restore; not an error. */
  protected readonly restoreHint = signal(false);

  private readonly loadRequests = new Subject<void>();

  /** Create: ready at once. Edit: loads the printer; `switchMap` drops superseded loads. */
  protected readonly load = toSignal(
    this.loadRequests.pipe(
      startWith(undefined),
      switchMap(() => {
        const id = this.printerId;
        if (id === null) return of<LoadState>({ kind: 'ready', printer: null });
        return this.api.get(id).pipe(
          map((printer): LoadState => {
            if (printer.archivedAt !== null) return { kind: 'archived' };
            this.populate(printer);
            return { kind: 'ready', printer };
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
    // Reinforced materials wear a brass nozzle. This is only a convenience so the user does not
    // build a combination the API will reject; the API enforces the real rule (ADR 0007).
    // `dirty` is true only for a change made by the user, so loading a printer never triggers it.
    this.form.controls.nozzleMaterial.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((material) => {
        if (!this.form.controls.nozzleMaterial.dirty) return;
        if (material === 'hardened_steel') {
          this.fibreMaterialsRemoved.set(false);
          return;
        }
        const materials = this.form.controls.materials;
        const kept = materials.value.filter((item) => !isReinforcedMaterial(item));
        if (kept.length === materials.value.length) return;
        materials.setValue(kept);
        materials.markAsDirty();
        this.fibreMaterialsRemoved.set(true);
      });
  }

  protected isMaterialDisabled(material: Material): boolean {
    return isReinforcedMaterial(material) && this.nozzleMaterial() !== 'hardened_steel';
  }

  /** Ids of the hint and error paragraphs that currently exist, for `aria-describedby`. */
  protected materialsDescribedBy(error: string | null): string | null {
    const ids = [
      ...(this.nozzleMaterial() === 'hardened_steel' ? [] : ['materials-hint']),
      ...(error === null ? [] : ['materials-error']),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  }

  protected toggleMaterial(material: Material, checked: boolean): void {
    const control = this.form.controls.materials;
    const current = control.value;
    control.setValue(
      MATERIAL_ORDER.filter((item) => (item === material ? checked : current.includes(item))),
    );
    control.markAsDirty();
    control.markAsTouched();
    this.fibreMaterialsRemoved.set(false);
  }

  /** The visible error for a field, or null. Shown once the user touched it or tried to save. */
  protected errorFor(field: FieldKey): string | null {
    const control = this.form.controls[field];
    const errors = control.errors;
    if (errors === null || !(control.touched || this.submitted())) return null;
    if (errors['conflict']) return 'Ya existe una impresora con ese nombre.';
    if (errors['server']) return SERVER_REJECTED[field];
    return VALIDATION_MESSAGES[field](errors);
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

    const printer = loaded.printer;
    if (printer === null) {
      this.sendCreate(values, false);
      return;
    }

    const body = this.changesFrom(printer, values);
    if (Object.keys(body).length === 1) {
      // Nothing changed: there is nothing to send (the API rejects an empty patch).
      void this.router.navigate(['/impresoras']);
      return;
    }
    this.send(this.api.update(printer.id, body), 'updated');
  }

  protected reload(): void {
    this.save.set({ kind: 'idle' });
    this.loadRequests.next();
  }

  /** The user agreed to restore the deleted printer: the same values, one more request. */
  protected confirmRestore(): void {
    if (this.save().kind === 'saving') return;
    const values = this.readValues();
    if (values === null || this.form.invalid) return;
    this.sendCreate(values, true);
  }

  protected cancelRestore(): void {
    if (this.save().kind === 'saving') return;
    this.restorePrompt.set(null);
    this.restoreHint.set(true);
    this.focusAfterRender(() => {
      this.focusField('name');
    });
  }

  private sendCreate(
    values: NonNullable<ReturnType<PrinterFormPage['readValues']>>,
    restoreIfDeleted: boolean,
  ): void {
    const body: CreatePrinterRequest = {
      name: values.name,
      buildVolume: values.buildVolume,
      nozzle: values.nozzle,
      compatibleMaterials: values.materials,
      status: values.status,
      ...(values.speed === null ? {} : { typicalSpeedMmS: values.speed }),
    };
    this.save.set({ kind: 'saving' });
    (restoreIfDeleted ? this.api.create(body, { restoreIfDeleted }) : this.api.create(body))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ restored }) => {
          this.finish(restored ? 'restored' : 'created');
        },
        error: (error: unknown) => {
          this.handleSaveError(error, values.name);
        },
      });
  }

  private send(request: ReturnType<PrintersApi['update']>, notice: 'updated'): void {
    this.save.set({ kind: 'saving' });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.finish(notice);
      },
      error: (error: unknown) => {
        this.handleSaveError(error, null);
      },
    });
  }

  private finish(notice: PrintersNotice): void {
    void this.router.navigate(['/impresoras'], { state: noticeState(notice) });
  }

  private focusAfterRender(focus: () => void): void {
    afterNextRender(focus, { injector: this.injector });
  }

  private handleSaveError(error: unknown, name: string | null): void {
    this.save.set({ kind: 'idle' });
    // A modal dialog makes the form inert, so focus may only move once it is gone.
    const wasRestoring = this.restorePrompt() !== null;
    this.restorePrompt.set(null);
    if (wasRestoring) {
      const focusName = error instanceof ApiError && error.status === 409 && hasPath(error, 'name');
      this.focusAfterRender(() => {
        if (focusName) this.focusField('name');
        else this.host.nativeElement.querySelector<HTMLElement>('button[type="submit"]')?.focus();
      });
    }
    if (!(error instanceof ApiError)) {
      this.save.set({ kind: 'failed', message: GENERIC_ERROR, stale: false });
      return;
    }

    if (error.status === 404 && this.printerId !== null) {
      void this.router.navigate(['/impresoras'], { state: noticeState('gone') });
      return;
    }

    if (error.status === 409) {
      if (hasPath(error, 'name')) {
        this.form.controls.name.setErrors({ conflict: true });
        this.focusField('name');
      } else if (hasPath(error, 'restoreIfDeleted') && name !== null && !wasRestoring) {
        // A deleted printer holds this name: ask before restoring it (ADR 0009).
        this.restoreHint.set(false);
        this.restorePrompt.set({ name });
      } else if (error.issues.some((issue) => issue.path === 'version')) {
        this.save.set({
          kind: 'failed',
          stale: true,
          message:
            'Alguien modificó esta impresora mientras la editabas. Recargala para ver los cambios actuales; tus cambios sin guardar se van a perder.',
        });
      } else {
        this.save.set({
          kind: 'failed',
          stale: false,
          message:
            'No se pudo guardar por un conflicto con otros datos. Revisalos e intentá de nuevo.',
        });
      }
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
      for (const field of fields) this.form.controls[field].setErrors({ server: true });
      this.focusFirstInvalid();
      return;
    }
    this.save.set({ kind: 'failed', message: error.message, stale: false });
  }

  private populate(printer: Printer): void {
    this.form.reset({
      name: printer.name,
      x: printer.buildVolume.x,
      y: printer.buildVolume.y,
      z: printer.buildVolume.z,
      diameterMm: printer.nozzle.diameterMm,
      nozzleMaterial: printer.nozzle.material,
      materials: MATERIAL_ORDER.filter((item) => printer.compatibleMaterials.includes(item)),
      speed: printer.typicalSpeedMmS,
      status: printer.status,
    });
    this.submitted.set(false);
    this.fibreMaterialsRemoved.set(false);
  }

  private readValues() {
    const raw = this.form.getRawValue();
    if (raw.x === null || raw.y === null || raw.z === null) return null;
    const nozzle: PrinterNozzle = {
      diameterMm: raw.diameterMm,
      material: raw.nozzleMaterial,
    };
    return {
      name: raw.name.trim(),
      buildVolume: { x: raw.x, y: raw.y, z: raw.z },
      nozzle,
      materials: raw.materials,
      speed: raw.speed,
      status: raw.status,
    };
  }

  /** Only what changed, plus the version the user loaded (ADR 0008). */
  private changesFrom(
    printer: Printer,
    values: NonNullable<ReturnType<PrinterFormPage['readValues']>>,
  ): UpdatePrinterRequest {
    const volumeChanged =
      values.buildVolume.x !== printer.buildVolume.x ||
      values.buildVolume.y !== printer.buildVolume.y ||
      values.buildVolume.z !== printer.buildVolume.z;
    const nozzleChanged =
      values.nozzle.diameterMm !== printer.nozzle.diameterMm ||
      values.nozzle.material !== printer.nozzle.material;

    return {
      version: printer.version,
      ...(values.name === printer.name ? {} : { name: values.name }),
      ...(volumeChanged ? { buildVolume: values.buildVolume } : {}),
      ...(nozzleChanged ? { nozzle: values.nozzle } : {}),
      ...(sameMembers(values.materials, printer.compatibleMaterials)
        ? {}
        : { compatibleMaterials: values.materials }),
      ...(values.speed === printer.typicalSpeedMmS ? {} : { typicalSpeedMmS: values.speed }),
      ...(values.status === printer.status ? {} : { status: values.status }),
    };
  }

  private focusFirstInvalid(): void {
    const first = FIELD_ORDER.find((field) => this.form.controls[field].invalid);
    if (first !== undefined) this.focusField(first);
  }

  private focusField(field: FieldKey): void {
    this.host.nativeElement.querySelector<HTMLElement>(`#${FOCUS_TARGET[field]}`)?.focus();
  }
}
