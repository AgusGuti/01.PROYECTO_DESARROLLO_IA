import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { CostSettings, UpdateCostSettingsRequest } from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import {
  basisPointsToPercentInput,
  minorToPesosInput,
  parsePercentToBasisPoints,
  parsePesosToMinor,
} from './cost-labels';
import { CostsApi } from './costs-api';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly settings: CostSettings }
  | { readonly kind: 'failed'; readonly message: string };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** `stale` means someone else saved first: the page offers to reload. */
  | { readonly kind: 'failed'; readonly message: string; readonly stale: boolean };

type FieldKey = 'kwh' | 'wear' | 'fixed' | 'margin';

const FIELD_ORDER: readonly FieldKey[] = ['kwh', 'wear', 'fixed', 'margin'];

/** Which control an API issue path belongs to. Unknown paths map to nothing. */
const ISSUE_FIELD: Readonly<Record<string, FieldKey>> = {
  kwhPriceMinor: 'kwh',
  wearPerHourMinor: 'wear',
  fixedPerJobMinor: 'fixed',
  defaultMarginBasisPoints: 'margin',
};

const MONEY_MESSAGE = 'Ingresá un importe en pesos, con coma para los centavos. Máximo 10.000.000.';
const VALIDATION_MESSAGES: Readonly<Record<FieldKey, string>> = {
  kwh: MONEY_MESSAGE,
  wear: MONEY_MESSAGE,
  fixed: MONEY_MESSAGE,
  margin: 'Ingresá un porcentaje de 0 a 1000, con hasta 2 decimales.',
};
const SERVER_REJECTED: Readonly<Record<FieldKey, string>> = {
  kwh: 'El precio del kWh no es válido.',
  wear: 'El desgaste por hora no es válido.',
  fixed: 'El costo fijo no es válido.',
  margin: 'El margen no es válido.',
};

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const INITIAL_LOAD: LoadState = { kind: 'loading' };

function pesosValidator(control: AbstractControl<string>): ValidationErrors | null {
  return parsePesosToMinor(control.value) === null ? { invalid: true } : null;
}

function percentValidator(control: AbstractControl<string>): ValidationErrors | null {
  return parsePercentToBasisPoints(control.value) === null ? { invalid: true } : null;
}

@Component({
  selector: 'app-cost-settings-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './cost-settings-page.html',
  styleUrl: './cost-settings-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostSettingsPage {
  private readonly api = inject(CostsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({
    kwh: this.fb.control('', pesosValidator),
    wear: this.fb.control('', pesosValidator),
    fixed: this.fb.control('', pesosValidator),
    margin: this.fb.control('', percentValidator),
  });

  protected readonly submitted = signal(false);
  protected readonly save = signal<SaveState>({ kind: 'idle' });
  protected readonly savedNotice = signal(false);
  /** The settings returned by the last successful save: they carry the newest version. */
  private readonly saved = signal<CostSettings | null>(null);

  private readonly loadRequests = new Subject<void>();

  /** Loads the settings; `switchMap` drops a superseded load (a second "Recargar"). */
  protected readonly load = toSignal(
    this.loadRequests.pipe(
      startWith(undefined),
      switchMap(() =>
        this.api.getSettings().pipe(
          map((settings): LoadState => {
            this.populate(settings);
            return { kind: 'ready', settings };
          }),
          catchError((error: unknown) =>
            of<LoadState>({
              kind: 'failed',
              message: error instanceof ApiError ? error.message : GENERIC_ERROR,
            }),
          ),
          startWith<LoadState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: INITIAL_LOAD },
  );

  /** The version the next save must send: that of the last save, else the loaded one. */
  private readonly currentVersion = computed(() => {
    const saved = this.saved();
    if (saved !== null) return saved.version;
    const loaded = this.load();
    return loaded.kind === 'ready' ? loaded.settings.version : 0;
  });

  /** True until the first save: the API answers zeros with version 0. */
  protected readonly neverSaved = computed(() => {
    const loaded = this.load();
    return loaded.kind === 'ready' && this.saved() === null && loaded.settings.version === 0;
  });

  protected errorFor(field: FieldKey): string | null {
    const control = this.form.controls[field];
    const errors = control.errors;
    if (errors === null || !(control.touched || this.submitted())) return null;
    return errors['server'] ? SERVER_REJECTED[field] : VALIDATION_MESSAGES[field];
  }

  protected submit(): void {
    if (this.save().kind === 'saving') return;
    this.submitted.set(true);
    this.savedNotice.set(false);
    this.form.markAllAsTouched();
    if (this.load().kind !== 'ready') return;

    const raw = this.form.getRawValue();
    const kwhPriceMinor = parsePesosToMinor(raw.kwh);
    const wearPerHourMinor = parsePesosToMinor(raw.wear);
    const fixedPerJobMinor = parsePesosToMinor(raw.fixed);
    const defaultMarginBasisPoints = parsePercentToBasisPoints(raw.margin);
    if (
      kwhPriceMinor === null ||
      wearPerHourMinor === null ||
      fixedPerJobMinor === null ||
      defaultMarginBasisPoints === null
    ) {
      this.focusFirstInvalid();
      return;
    }

    const body: UpdateCostSettingsRequest = {
      kwhPriceMinor,
      wearPerHourMinor,
      fixedPerJobMinor,
      defaultMarginBasisPoints,
      version: this.currentVersion(),
    };
    this.save.set({ kind: 'saving' });
    this.api
      .putSettings(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.saved.set(settings);
          this.save.set({ kind: 'idle' });
          this.savedNotice.set(true);
        },
        error: (error: unknown) => {
          this.handleSaveError(error);
        },
      });
  }

  /** Discards what is typed and reads the settings again, with their newest version. */
  protected reload(): void {
    this.save.set({ kind: 'idle' });
    this.savedNotice.set(false);
    this.saved.set(null);
    this.loadRequests.next();
  }

  private handleSaveError(error: unknown): void {
    if (!(error instanceof ApiError)) {
      this.save.set({ kind: 'failed', message: GENERIC_ERROR, stale: false });
      return;
    }

    if (error.status === 409 && error.issues.some((issue) => issue.path === 'version')) {
      this.save.set({
        kind: 'failed',
        stale: true,
        message:
          'Alguien modificó estas tarifas mientras las editabas. Recargá para ver los valores actuales; tus cambios sin guardar se van a perder.',
      });
      return;
    }

    if (error.status === 400) {
      const fields = new Set<FieldKey>();
      for (const issue of error.issues) {
        const field = ISSUE_FIELD[issue.path];
        if (field !== undefined) fields.add(field);
      }
      if (fields.size > 0) {
        for (const field of fields) this.form.controls[field].setErrors({ server: true });
        this.save.set({ kind: 'idle' });
        this.focusFirstInvalid();
        return;
      }
    }
    this.save.set({ kind: 'failed', message: error.message, stale: false });
  }

  private populate(settings: CostSettings): void {
    this.form.reset({
      kwh: minorToPesosInput(settings.kwhPriceMinor),
      wear: minorToPesosInput(settings.wearPerHourMinor),
      fixed: minorToPesosInput(settings.fixedPerJobMinor),
      margin: basisPointsToPercentInput(settings.defaultMarginBasisPoints),
    });
    this.submitted.set(false);
  }

  private focusFirstInvalid(): void {
    const first = FIELD_ORDER.find((field) => this.form.controls[field].invalid);
    if (first !== undefined) {
      this.host.nativeElement.querySelector<HTMLElement>(`#field-${first}`)?.focus();
    }
  }
}
