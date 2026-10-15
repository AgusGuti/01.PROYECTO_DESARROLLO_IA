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
  type FormControl,
  type FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  CostWarningCode,
  Material,
  ProjectCostEstimate,
  ProjectCostEstimateRequest,
} from '@print3d/api-contracts';
import {
  catchError,
  EMPTY,
  merge,
  map,
  of,
  startWith,
  scan,
  Subject,
  switchMap,
  type Observable,
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
  type PickerPrinter,
  type PickerProject,
  CostsPickersApi,
} from './costs-pickers-api';

type CatalogueState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly items: readonly T[]; readonly truncated: boolean }
  | { readonly kind: 'failed'; readonly message: string };

/** One project line on screen. `index` is its position in the form (live lines only). */
type Row =
  | {
      readonly kind: 'live';
      readonly index: number;
      readonly partId: string;
      readonly name: string;
      readonly material: Material;
      readonly quantity: number;
    }
  | { readonly kind: 'deleted'; readonly partId: string; readonly quantity: number };

type LiveRow = Extract<Row, { kind: 'live' }>;

type ProjectState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'empty'; readonly projectId: string; readonly name: string }
  | {
      readonly kind: 'ready';
      readonly projectId: string;
      readonly name: string;
      readonly rows: readonly Row[];
    };

type ResultState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'calculating' }
  | {
      readonly kind: 'done';
      readonly estimate: ProjectCostEstimate;
      /** Per requested line: true when it was a sale. */
      readonly sales: readonly boolean[];
    }
  | { readonly kind: 'failed'; readonly message: string };

type LineGroup = FormGroup<{
  filamentId: FormControl<string>;
  printerId: FormControl<string>;
  sale: FormControl<boolean>;
  margin: FormControl<string>;
}>;

type SpoolMap = Partial<Record<Material, CatalogueState<PickerFilament>>>;

type LineField = 'spool' | 'printer' | 'margin';

const VALIDATION_MESSAGES: Readonly<Record<LineField, string>> = {
  spool: 'Elegí una bobina.',
  printer: 'La impresora no es válida.',
  margin: 'Ingresá solo números, con hasta 2 decimales, entre 0 y 1000.',
};

const SERVER_REJECTED: Readonly<Record<LineField, string>> = {
  spool: 'La bobina elegida no existe o su material no coincide con el de la pieza.',
  printer: 'La impresora elegida ya no existe.',
  margin: 'El margen no es válido.',
};

const ROW_REJECTED = {
  partId: 'La pieza ya no existe. Quitala del proyecto para calcular.',
  quantity: 'La cantidad o el resultado de esta línea es demasiado grande.',
} as const;

/** The same codes as the single estimate, worded for several lines. */
const PROJECT_WARNING_MESSAGES: Readonly<Record<CostWarningCode, string>> = {
  ...WARNING_MESSAGES,
  filament_insufficient: 'La bobina elegida no alcanza para todas las líneas que la usan.',
  electricity_printer_not_selected:
    'En alguna línea no elegiste impresora: el costo no incluye su electricidad.',
  electricity_printer_power_unknown:
    'Alguna impresora no tiene cargada su potencia: el costo no incluye su electricidad.',
};

const NO_SPOOLS: SpoolMap = {};
const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const LOADING: { readonly kind: 'loading' } = { kind: 'loading' };
const LINE_PATH = /^lines\.(\d+)\.(partId|filamentId|printerId|quantity)$/;
const GRAMS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function requiredText(control: AbstractControl<string>): ValidationErrors | null {
  return control.value === '' ? { required: true } : null;
}

function failedState(error: unknown): { readonly kind: 'failed'; readonly message: string } {
  return { kind: 'failed', message: error instanceof ApiError ? error.message : GENERIC_ERROR };
}

/** Display only: 9000 s becomes "2 h 30 min". */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

@Component({
  selector: 'app-project-cost-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './project-cost-page.html',
  styleUrl: './project-cost-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectCostPage {
  private readonly api = inject(CostsApi);
  private readonly pickers = inject(CostsPickersApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly projectId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  /** Margin typed by default in a new sale line; filled from the settings when they load. */
  private defaultMargin = '';

  protected readonly lines = this.fb.array<LineGroup>([]);
  protected readonly form = this.fb.group({ lines: this.lines });
  protected readonly submitted = signal(false);
  /** Lines the API rejected as a whole (part gone, quantity too large), by form index. */
  protected readonly rejectedRows = signal<ReadonlyMap<number, string>>(new Map());

  private readonly projectRetry = new Subject<void>();
  private readonly printersRetry = new Subject<void>();
  private readonly spoolsAttempt = signal(0);
  private readonly estimateRequests = new Subject<ProjectCostEstimateRequest | null>();

  protected readonly project = toSignal(
    this.projectRetry.pipe(
      startWith(undefined),
      switchMap((): Observable<ProjectState> => {
        const id = this.projectId;
        if (id === null) return of<ProjectState>({ kind: 'failed', message: GENERIC_ERROR });
        return this.pickers.project(id).pipe(
          map((project): ProjectState => this.toState(project)),
          catchError((error: unknown) => of<ProjectState>(failedState(error))),
          startWith<ProjectState>(LOADING),
        );
      }),
    ),
    { initialValue: LOADING },
  );

  protected readonly printers = toSignal(
    this.printersRetry.pipe(
      startWith(undefined),
      switchMap(() =>
        this.pickers.printers().pipe(
          map((catalogue): CatalogueState<PickerPrinter> => ({ kind: 'ready', ...catalogue })),
          catchError((error: unknown) => of<CatalogueState<PickerPrinter>>(failedState(error))),
          startWith<CatalogueState<PickerPrinter>>(LOADING),
        ),
      ),
    ),
    { initialValue: LOADING },
  );

  private readonly materials = computed((): readonly Material[] => {
    const state = this.project();
    if (state.kind !== 'ready') return [];
    const found = new Set<Material>();
    for (const row of state.rows) if (row.kind === 'live') found.add(row.material);
    return [...found];
  });

  /** Spools per material, each read once however many lines use it. Missing means loading. */
  protected readonly spools = toSignal(
    toObservable(
      computed(() => ({ materials: this.materials(), attempt: this.spoolsAttempt() })),
    ).pipe(
      switchMap(({ materials }): Observable<SpoolMap> => {
        if (materials.length === 0) return of<SpoolMap>({});
        return merge(
          ...materials.map((material) =>
            this.pickers.filaments(material).pipe(
              map((catalogue) => {
                this.preselectOnlySpool(material, catalogue);
                return [material, { kind: 'ready', ...catalogue } as const] as const;
              }),
              catchError((error: unknown) => of([material, failedState(error)] as const)),
            ),
          ),
        ).pipe(
          // Each material shows up as soon as its own answer arrives.
          scan(
            (byMaterial: SpoolMap, [material, state]): SpoolMap => ({
              ...byMaterial,
              [material]: state,
            }),
            {},
          ),
          startWith<SpoolMap>({}),
        );
      }),
    ),
    { initialValue: NO_SPOOLS },
  );

  protected readonly result = toSignal(
    this.estimateRequests.pipe(
      // `switchMap` cancels a request in flight when an input changes (`null`).
      switchMap((request) => {
        if (request === null) return of<ResultState>({ kind: 'idle' });
        return this.api.estimateProject(request).pipe(
          map((estimate): ResultState => {
            if (estimate.lines.length !== request.lines.length) {
              return { kind: 'failed', message: 'El servidor respondió algo inesperado.' };
            }
            return {
              kind: 'done',
              estimate,
              sales: request.lines.map((line) => line.marginBasisPoints !== undefined),
            };
          }),
          catchError((error: unknown) => of<ResultState>(this.failureOf(error))),
          startWith<ResultState>({ kind: 'calculating' }),
        );
      }),
    ),
    { initialValue: { kind: 'idle' } },
  );

  protected readonly deletedCount = computed(() => {
    const state = this.project();
    return state.kind === 'ready' ? state.rows.filter((row) => row.kind === 'deleted').length : 0;
  });

  protected readonly liveRows = computed((): readonly LiveRow[] => {
    const state = this.project();
    return state.kind === 'ready'
      ? state.rows.filter((row): row is LiveRow => row.kind === 'live')
      : [];
  });

  constructor() {
    // The default margin only pre-fills a sale line; the API never applies it itself.
    // If the settings cannot be read the field stays empty and the user types the margin.
    this.api
      .getSettings()
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((settings) => {
        this.defaultMargin = basisPointsToPercentInput(settings.defaultMarginBasisPoints);
        for (const line of this.lines.controls) {
          if (!line.controls.margin.dirty && line.controls.margin.value === '') {
            line.controls.margin.setValue(this.defaultMargin, { emitEvent: false });
          }
        }
      });
    // Any input change invalidates what was calculated.
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.rejectedRows.set(new Map());
      this.estimateRequests.next(null);
    });
  }

  private makeLine(): LineGroup {
    const sale = this.fb.control(false);
    const group = this.fb.group({
      filamentId: this.fb.control('', requiredText),
      printerId: this.fb.control(''),
      sale,
      margin: this.fb.control(this.defaultMargin, (control: AbstractControl<string>) =>
        sale.value && parsePercentToBasisPoints(control.value) === null ? { invalid: true } : null,
      ),
    });
    sale.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      group.controls.margin.updateValueAndValidity({ emitEvent: false });
    });
    return group;
  }

  /** Builds one form group per live line; deleted parts get none (they are not calculated). */
  private toState(project: PickerProject): ProjectState {
    // A retry or reload rebuilds the form, so whatever the user already chose is reset.
    this.lines.clear({ emitEvent: false });
    if (project.items.length === 0) {
      return { kind: 'empty', projectId: project.id, name: project.name };
    }
    const rows: Row[] = project.items.map((item): Row => {
      if (item.part === null) {
        return { kind: 'deleted', partId: item.partId, quantity: item.quantity };
      }
      this.lines.push(this.makeLine(), { emitEvent: false });
      return {
        kind: 'live',
        index: this.lines.length - 1,
        partId: item.partId,
        name: item.part.name,
        material: item.part.material,
        quantity: item.quantity,
      };
    });
    return { kind: 'ready', projectId: project.id, name: project.name, rows };
  }

  /** One spool only: nothing to decide, so it is chosen for the lines of that material. */
  private preselectOnlySpool(material: Material, catalogue: PickerCatalogue<PickerFilament>): void {
    const [only] = catalogue.items;
    if (catalogue.items.length !== 1 || only === undefined) return;
    for (const row of this.liveRows()) {
      const control = this.lines.at(row.index).controls.filamentId;
      if (row.material === material && control.value === '') control.setValue(only.id);
    }
  }

  protected spoolsOf(material: Material): CatalogueState<PickerFilament> {
    return this.spools()[material] ?? LOADING;
  }

  protected errorFor(index: number, field: LineField): string | null {
    const group = this.lines.at(index);
    const control = {
      spool: group.controls.filamentId,
      printer: group.controls.printerId,
      margin: group.controls.margin,
    }[field];
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
  protected formatDuration = formatDuration;
  protected formatGrams = (grams: number): string => GRAMS.format(grams);
  protected warningText = (code: CostWarningCode): string => PROJECT_WARNING_MESSAGES[code];

  protected nameOfLine(index: number): string {
    return this.liveRows()[index]?.name ?? '';
  }

  protected retryProject(): void {
    this.projectRetry.next();
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
    if (this.lines.invalid) {
      this.focusFirstInvalid();
      return;
    }

    const request: ProjectCostEstimateRequest = {
      lines: this.liveRows().map((row) => {
        const raw = this.lines.at(row.index).getRawValue();
        const margin = raw.sale ? parsePercentToBasisPoints(raw.margin) : null;
        return {
          partId: row.partId,
          filamentId: raw.filamentId,
          quantity: row.quantity,
          ...(raw.printerId === '' ? {} : { printerId: raw.printerId }),
          // No margin unless "¿Venta?" is checked: the default margin is never applied silently.
          ...(margin === null ? {} : { marginBasisPoints: margin }),
        };
      }),
    };
    this.estimateRequests.next(request);
  }

  private failureOf(error: unknown): ResultState {
    if (!(error instanceof ApiError)) return { kind: 'failed', message: GENERIC_ERROR };
    if (error.status === 400) {
      const rejected = new Map<number, string>();
      let marked = false;
      let wholeList = false;
      for (const issue of error.issues) {
        if (issue.path === 'lines') wholeList = true;
        const match = LINE_PATH.exec(issue.path);
        const index = Number(match?.[1]);
        const field = match?.[2];
        if (field === undefined || index >= this.lines.length) continue;
        marked = true;
        if (field === 'partId' || field === 'quantity') {
          rejected.set(index, ROW_REJECTED[field]);
        } else {
          const group = this.lines.at(index);
          (field === 'filamentId' ? group.controls.filamentId : group.controls.printerId).setErrors(
            {
              server: true,
            },
          );
        }
      }
      if (marked) {
        this.rejectedRows.set(rejected);
        this.focusFirstInvalid();
        return { kind: 'failed', message: 'Revisá los datos marcados e intentá de nuevo.' };
      }
      if (wholeList) {
        return {
          kind: 'failed',
          message: 'El total del proyecto es demasiado grande para calcularlo.',
        };
      }
    }
    return { kind: 'failed', message: error.message };
  }

  private focusFirstInvalid(): void {
    const rejected = this.rejectedRows();
    for (const row of this.liveRows()) {
      const group = this.lines.at(row.index);
      const target = rejected.has(row.index)
        ? `line-${String(row.index)}-title`
        : group.controls.filamentId.invalid
          ? `line-${String(row.index)}-spool`
          : group.controls.printerId.invalid
            ? `line-${String(row.index)}-printer`
            : group.controls.margin.invalid
              ? `line-${String(row.index)}-margin`
              : null;
      if (target !== null) {
        // The control may not be rendered (spools loading, failed or empty): focus the line title.
        const root = this.host.nativeElement;
        const element =
          root.querySelector<HTMLElement>(`#${target}`) ??
          root.querySelector<HTMLElement>(`#line-${String(row.index)}-title`);
        element?.focus();
        return;
      }
    }
  }
}
