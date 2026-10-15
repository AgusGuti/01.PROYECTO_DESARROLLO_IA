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
  CreatePartRequest,
  GcodeAnalysis,
  GcodeWarningCode,
  Material,
  Part,
  PartSourceInput,
  UpdatePartRequest,
} from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { GcodeAnalysisApi } from './gcode-analysis-api';
import {
  formatInstantDate,
  GCODE_WARNING_LABELS,
  hmsToSeconds,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  parseMmToUm,
  secondsToHms,
  toSourceFileName,
  umToMmInput,
} from './part-labels';
import { PartsApi } from './parts-api';
import { noticeState, type PartsNotice } from './parts-notice';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly part: Part | null }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'failed'; readonly message: string };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** `stale` means someone else saved first: the page offers to reload. */
  | { readonly kind: 'failed'; readonly message: string; readonly stale: boolean };

type ImportStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'failed'; readonly message: string };

/** The last successful import: what the body's `source` is built from, and what is shown. */
interface Imported {
  /** Shown as text only (Angular interpolation), never as HTML. */
  readonly fileName: string;
  /** The sanitised name sent to the API. */
  readonly sourceName: string;
  readonly material: Material;
  readonly warnings: readonly GcodeWarningCode[];
}

type FieldKey =
  | 'name'
  | 'description'
  | 'material'
  | 'dimX'
  | 'dimY'
  | 'dimZ'
  | 'weight'
  | 'time'
  | 'layerHeight'
  | 'printer';

/** Controls an import can fill in; each shows an "importado" badge until the user edits it. */
type PrefillKey = 'dimensions' | 'weight' | 'time' | 'layerHeight' | 'printer';

/** Top-to-bottom order, used to move focus to the first invalid field. */
const FIELD_ORDER: readonly FieldKey[] = [
  'name',
  'description',
  'material',
  'dimX',
  'dimY',
  'dimZ',
  'weight',
  'time',
  'layerHeight',
  'printer',
];

const FOCUS_TARGET: Readonly<Record<FieldKey, string>> = {
  name: 'field-name',
  description: 'field-description',
  material: 'field-material',
  dimX: 'field-dim-x',
  dimY: 'field-dim-y',
  dimZ: 'field-dim-z',
  weight: 'field-weight',
  time: 'field-hours',
  layerHeight: 'field-layer',
  printer: 'field-printer',
};

const PREFILL_OF: Readonly<Partial<Record<FieldKey, PrefillKey>>> = {
  dimX: 'dimensions',
  dimY: 'dimensions',
  dimZ: 'dimensions',
  weight: 'weight',
  time: 'time',
  layerHeight: 'layerHeight',
  printer: 'printer',
};

/** Which control an API issue path belongs to. Unknown paths map to nothing. */
const ISSUE_FIELD: Readonly<Record<string, FieldKey>> = {
  name: 'name',
  description: 'description',
  material: 'material',
  dimensionsMm: 'dimX',
  'dimensionsMm.x': 'dimX',
  'dimensionsMm.y': 'dimY',
  'dimensionsMm.z': 'dimZ',
  estimatedWeightGrams: 'weight',
  estimatedPrintSeconds: 'time',
  layerHeightUm: 'layerHeight',
  suggestedPrinterName: 'printer',
};

const SERVER_REJECTED: Readonly<Record<FieldKey, string>> = {
  name: 'El nombre no es válido.',
  description: 'La descripción no es válida.',
  material: 'El material no es válido.',
  dimX: 'El ancho (X) no es válido.',
  dimY: 'El largo (Y) no es válido.',
  dimZ: 'El alto (Z) no es válido.',
  weight: 'El peso estimado no es válido.',
  time: 'El tiempo de impresión no es válido.',
  layerHeight: 'La altura de capa no es válida.',
  printer: 'La impresora sugerida no es válida.',
};

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_PRINTER_LENGTH = 100;
const MAX_DIMENSION_MM = 1000;
const MAX_WEIGHT_GRAMS = 20_000;
const MAX_PRINT_SECONDS = 2_592_000;
/** The API reads at most this many characters of the file head (ADR 0014). */
const HEAD_LIMIT = 65_536;
const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const INITIAL_LOAD: LoadState = { kind: 'loading' };
const IDLE_IMPORT: ImportStatus = { kind: 'idle' };

const IMPORT_UNRECOGNISED =
  'No reconocemos este G-code. Por ahora solo leemos archivos de Cura; cargá los datos a mano.';
const IMPORT_UNREADABLE = 'No pudimos leer ese archivo.';

/** Message for each field's own client-side validation errors. */
const VALIDATION_MESSAGES: Readonly<Record<FieldKey, (errors: ValidationErrors) => string>> = {
  name: (errors) =>
    errors['maxlength']
      ? `El nombre puede tener hasta ${String(MAX_NAME_LENGTH)} caracteres.`
      : errors['control']
        ? 'El nombre no puede tener saltos de línea ni caracteres de control.'
        : 'Ingresá el nombre.',
  description: (errors) =>
    errors['maxlength']
      ? `La descripción puede tener hasta ${String(MAX_DESCRIPTION_LENGTH)} caracteres.`
      : 'La descripción debe ser una sola línea, sin caracteres de control.',
  material: () => SERVER_REJECTED.material,
  dimX: () => `Ingresá un ancho entero entre 1 y ${String(MAX_DIMENSION_MM)} mm.`,
  dimY: () => `Ingresá un largo entero entre 1 y ${String(MAX_DIMENSION_MM)} mm.`,
  dimZ: () => `Ingresá un alto entero entre 1 y ${String(MAX_DIMENSION_MM)} mm.`,
  weight: () => `Ingresá un peso entero entre 1 y ${String(MAX_WEIGHT_GRAMS)} g.`,
  time: () =>
    'Ingresá un tiempo mayor a cero, de hasta 720 horas (minutos y segundos entre 0 y 59).',
  layerHeight: () =>
    'Ingresá la altura de capa en milímetros, con coma (por ejemplo 0,2), entre 0,01 y 2.',
  printer: (errors) =>
    errors['maxlength']
      ? `La impresora sugerida puede tener hasta ${String(MAX_PRINTER_LENGTH)} caracteres.`
      : 'La impresora sugerida no puede tener caracteres de control.',
};

// Client validation mirrors the API limits. It is a convenience: the server decides.
function textValidator(max: number, optional: boolean): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const text = String(control.value).trim();
    if (text.length === 0) return optional ? null : { required: true };
    if (/\p{Cc}/u.test(text)) return { control: true };
    return Array.from(text).length > max ? { maxlength: true } : null;
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

function layerValidator(control: AbstractControl<string>): ValidationErrors | null {
  return parseMmToUm(control.value) === null ? { format: true } : null;
}

/** Hours, minutes and seconds are each optional (empty is 0), but the total must be 1..30 days. */
function timeTotalValidator(group: AbstractControl): ValidationErrors | null {
  const read = (name: string): unknown => group.get(name)?.value;
  const parts = [read('hours'), read('minutes'), read('seconds')].map((part) =>
    typeof part === 'number' ? part : 0,
  );
  const total = hmsToSeconds(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
  return total >= 1 && total <= MAX_PRINT_SECONDS ? null : { range: true };
}

function hasPath(error: ApiError, path: string): boolean {
  return error.issues.some((issue) => issue.path === path);
}

interface FormValues {
  readonly name: string;
  readonly description: string | null;
  readonly material: Material;
  readonly dimensions: { readonly x: number; readonly y: number; readonly z: number };
  readonly weight: number;
  readonly seconds: number;
  readonly layerHeightUm: number;
  readonly printer: string | null;
}

@Component({
  selector: 'app-part-form-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './part-form-page.html',
  styleUrl: './part-form-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartFormPage {
  private readonly api = inject(PartsApi);
  private readonly gcodeApi = inject(GcodeAnalysisApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);

  /** `null` on /piezas/nueva, the part id on /piezas/:id/editar. */
  protected readonly partId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  protected readonly materialOptions = MATERIAL_ORDER.map((value) => ({
    value,
    label: MATERIAL_LABELS[value],
  }));

  protected readonly form = this.fb.group({
    name: this.fb.control('', textValidator(MAX_NAME_LENGTH, false)),
    description: this.fb.control('', textValidator(MAX_DESCRIPTION_LENGTH, true)),
    material: this.fb.control<Material>('PLA'),
    dimX: this.fb.control<number | null>(null, wholeNumberBetween(1, MAX_DIMENSION_MM, false)),
    dimY: this.fb.control<number | null>(null, wholeNumberBetween(1, MAX_DIMENSION_MM, false)),
    dimZ: this.fb.control<number | null>(null, wholeNumberBetween(1, MAX_DIMENSION_MM, false)),
    weight: this.fb.control<number | null>(null, wholeNumberBetween(1, MAX_WEIGHT_GRAMS, false)),
    time: this.fb.group(
      {
        hours: this.fb.control<number | null>(null, wholeNumberBetween(0, 720, true)),
        minutes: this.fb.control<number | null>(null, wholeNumberBetween(0, 59, true)),
        seconds: this.fb.control<number | null>(null, wholeNumberBetween(0, 59, true)),
      },
      { validators: timeTotalValidator },
    ),
    layerHeight: this.fb.control('', layerValidator),
    printer: this.fb.control('', textValidator(MAX_PRINTER_LENGTH, true)),
  });

  protected readonly submitted = signal(false);
  protected readonly save = signal<SaveState>({ kind: 'idle' });
  protected readonly importStatus = signal<ImportStatus>(IDLE_IMPORT);
  protected readonly imported = signal<Imported | null>(null);
  /** Controls an import filled in and the user has not edited since. */
  protected readonly prefilled = signal<ReadonlySet<PrefillKey>>(new Set());

  private readonly loadRequests = new Subject<void>();

  /** Create: ready at once. Edit: loads the part; `switchMap` drops superseded loads. */
  protected readonly load = toSignal(
    this.loadRequests.pipe(
      startWith(undefined),
      switchMap(() => {
        const id = this.partId;
        if (id === null) return of<LoadState>({ kind: 'ready', part: null });
        return this.api.get(id).pipe(
          map((part): LoadState => {
            this.populate(part);
            return { kind: 'ready', part };
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

  private controlFor(field: FieldKey): AbstractControl {
    return this.form.controls[field];
  }

  /** The visible error for a field, or null. Shown once the user touched it or tried to save. */
  protected errorFor(field: FieldKey): string | null {
    const control = this.controlFor(field);
    if (!control.invalid || !(control.touched || this.submitted())) return null;
    if (control.errors?.['server']) return SERVER_REJECTED[field];
    return VALIDATION_MESSAGES[field](control.errors ?? {});
  }

  /** Ids of the hint, badge and error paragraphs that currently exist, for `aria-describedby`. */
  protected describedBy(field: FieldKey, hintId: string | null): string | null {
    const prefill = PREFILL_OF[field];
    const ids = [
      ...(hintId === null ? [] : [hintId]),
      ...(prefill !== undefined && this.prefilled().has(prefill) ? [`badge-${prefill}`] : []),
      ...(this.errorFor(field) === null ? [] : [`error-${field}`]),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  }

  /** The user typed in a prefilled control: it is theirs now, so its badge goes. */
  protected clearBadge(key: PrefillKey): void {
    if (!this.prefilled().has(key)) return;
    this.prefilled.update((current) => new Set([...current].filter((item) => item !== key)));
  }

  /** Warnings and the "origin" line, as text for the template. */
  protected warningText(code: GcodeWarningCode): string {
    return GCODE_WARNING_LABELS[code];
  }

  protected showMaterialHint(imported: Imported): boolean {
    return this.form.controls.material.value !== imported.material;
  }

  protected originText(part: Part): string {
    return part.source.kind === 'gcode'
      ? `Origen: G-code «${part.source.fileName}» (Cura), importado el ${formatInstantDate(part.source.analyzedAt)}`
      : 'Origen: carga manual';
  }

  // ---- import --------------------------------------------------------------------------------

  protected async onFileChosen(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    // Let the same file be chosen again later (the browser fires no change event otherwise).
    input.value = '';
    if (file === undefined || this.importStatus().kind === 'working') return;
    this.importStatus.set({ kind: 'working' });

    let head: string;
    try {
      head = await file.slice(0, HEAD_LIMIT).text();
    } catch {
      this.importStatus.set({ kind: 'failed', message: IMPORT_UNREADABLE });
      return;
    }

    const material = this.form.controls.material.value;
    this.gcodeApi
      .analyse(head, material)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (analysis) => {
          this.applyAnalysis(analysis, file.name, material);
        },
        error: (error: unknown) => {
          this.importStatus.set({ kind: 'failed', message: this.importErrorMessage(error) });
        },
      });
  }

  private importErrorMessage(error: unknown): string {
    if (!(error instanceof ApiError)) return GENERIC_ERROR;
    if (error.status === 400 && hasPath(error, 'head')) return IMPORT_UNRECOGNISED;
    if (error.status === 413) return IMPORT_UNREADABLE;
    return error.message;
  }

  private applyAnalysis(analysis: GcodeAnalysis, fileName: string, material: Material): void {
    const filled: PrefillKey[] = ['time'];
    const { controls } = this.form;

    controls.time.reset(secondsToHms(analysis.estimatedPrintSeconds));
    if (analysis.filamentGrams !== null) {
      controls.weight.setValue(analysis.filamentGrams);
      filled.push('weight');
    }
    if (analysis.dimensionsMm !== null) {
      controls.dimX.setValue(analysis.dimensionsMm.x);
      controls.dimY.setValue(analysis.dimensionsMm.y);
      controls.dimZ.setValue(analysis.dimensionsMm.z);
      filled.push('dimensions');
    }
    if (analysis.layerHeightUm !== null) {
      controls.layerHeight.setValue(umToMmInput(analysis.layerHeightUm));
      filled.push('layerHeight');
    }
    if (analysis.targetMachineName !== null) {
      controls.printer.setValue(analysis.targetMachineName);
      filled.push('printer');
    }

    this.prefilled.set(new Set(filled));
    this.imported.set({
      fileName,
      sourceName: toSourceFileName(fileName),
      material,
      warnings: analysis.warnings.map((warning) => warning.code),
    });
    this.importStatus.set(IDLE_IMPORT);
  }

  // ---- save ----------------------------------------------------------------------------------

  protected submit(): void {
    if (this.save().kind === 'saving' || this.importStatus().kind === 'working') return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const loaded = this.load();
    const values = this.readValues();
    if (this.form.invalid || values === null || loaded.kind !== 'ready') {
      this.focusFirstInvalid();
      return;
    }

    const part = loaded.part;
    const source = this.sourceInput();
    if (part === null) {
      const body: CreatePartRequest = {
        name: values.name,
        ...(values.description === null ? {} : { description: values.description }),
        material: values.material,
        dimensionsMm: values.dimensions,
        estimatedWeightGrams: values.weight,
        estimatedPrintSeconds: values.seconds,
        layerHeightUm: values.layerHeightUm,
        ...(values.printer === null ? {} : { suggestedPrinterName: values.printer }),
        // Without an import the server defaults the source to manual.
        ...(source === null ? {} : { source }),
      };
      this.send(this.api.create(body), 'created');
      return;
    }

    const body = this.changesFrom(part, values, source);
    if (Object.keys(body).length === 1) {
      // Nothing changed: there is nothing to send (the API rejects an empty patch).
      void this.router.navigate(['/piezas']);
      return;
    }
    this.send(this.api.update(part.id, body), 'updated');
  }

  protected reload(): void {
    this.save.set({ kind: 'idle' });
    this.loadRequests.next();
  }

  private send(request: ReturnType<PartsApi['create']>, notice: PartsNotice): void {
    this.save.set({ kind: 'saving' });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        void this.router.navigate(['/piezas'], { state: noticeState(notice) });
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

    if (error.status === 404 && this.partId !== null) {
      void this.router.navigate(['/piezas'], { state: noticeState('gone') });
      return;
    }

    if (error.status === 409) {
      this.save.set(
        hasPath(error, 'version')
          ? {
              kind: 'failed',
              stale: true,
              message:
                'Alguien modificó esta pieza mientras la editabas. Recargala para ver los cambios actuales; tus cambios sin guardar se van a perder.',
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
      for (const field of fields) this.controlFor(field).setErrors({ server: true });
      this.focusFirstInvalid();
      return;
    }
    this.save.set({ kind: 'failed', message: error.message, stale: false });
  }

  private populate(part: Part): void {
    this.form.reset({
      name: part.name,
      description: part.description ?? '',
      material: part.material,
      dimX: part.dimensionsMm.x,
      dimY: part.dimensionsMm.y,
      dimZ: part.dimensionsMm.z,
      weight: part.estimatedWeightGrams,
      time: secondsToHms(part.estimatedPrintSeconds),
      layerHeight: umToMmInput(part.layerHeightUm),
      printer: part.suggestedPrinterName ?? '',
    });
    this.submitted.set(false);
    this.imported.set(null);
    this.importStatus.set(IDLE_IMPORT);
    this.prefilled.set(new Set());
  }

  private readValues(): FormValues | null {
    const raw = this.form.getRawValue();
    const layerHeightUm = parseMmToUm(raw.layerHeight);
    if (
      raw.dimX === null ||
      raw.dimY === null ||
      raw.dimZ === null ||
      raw.weight === null ||
      layerHeightUm === null
    ) {
      return null;
    }
    const description = raw.description.trim();
    const printer = raw.printer.trim();
    return {
      name: raw.name.trim(),
      description: description === '' ? null : description,
      material: raw.material,
      dimensions: { x: raw.dimX, y: raw.dimY, z: raw.dimZ },
      weight: raw.weight,
      seconds: hmsToSeconds(raw.time.hours ?? 0, raw.time.minutes ?? 0, raw.time.seconds ?? 0),
      layerHeightUm,
      printer: printer === '' ? null : printer,
    };
  }

  /** Present only after an import in this session. */
  private sourceInput(): PartSourceInput | null {
    const imported = this.imported();
    return imported === null
      ? null
      : { kind: 'gcode', fileName: imported.sourceName, slicer: 'cura' };
  }

  /** Only what changed, plus the version the user loaded (ADR 0008). */
  private changesFrom(
    part: Part,
    values: FormValues,
    source: PartSourceInput | null,
  ): UpdatePartRequest {
    const was = part.dimensionsMm;
    const now = values.dimensions;
    const dimensionsChanged = was.x !== now.x || was.y !== now.y || was.z !== now.z;
    return {
      version: part.version,
      ...(values.name === part.name ? {} : { name: values.name }),
      // An emptied optional field is sent as null: that is how the API clears it.
      ...(values.description === part.description ? {} : { description: values.description }),
      ...(values.material === part.material ? {} : { material: values.material }),
      ...(dimensionsChanged ? { dimensionsMm: now } : {}),
      ...(values.weight === part.estimatedWeightGrams
        ? {}
        : { estimatedWeightGrams: values.weight }),
      ...(values.seconds === part.estimatedPrintSeconds
        ? {}
        : { estimatedPrintSeconds: values.seconds }),
      ...(values.layerHeightUm === part.layerHeightUm
        ? {}
        : { layerHeightUm: values.layerHeightUm }),
      ...(values.printer === part.suggestedPrinterName
        ? {}
        : { suggestedPrinterName: values.printer }),
      ...(source === null ? {} : { source }),
    };
  }

  private focusFirstInvalid(): void {
    const first = FIELD_ORDER.find((field) => this.controlFor(field).invalid);
    if (first === undefined) return;
    this.host.nativeElement.querySelector<HTMLElement>(`#${FOCUS_TARGET[first]}`)?.focus();
  }
}
