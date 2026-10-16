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
import type { PlanningSettings, UpdatePlanningSettingsRequest } from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { PlanningApi } from './planning-api';
import { basisPointsToPercentInput, parsePercentToBasisPoints } from './planning-labels';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly settings: PlanningSettings }
  | { readonly kind: 'failed'; readonly message: string };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** `stale` means someone else saved first: the page offers to reload. */
  | { readonly kind: 'failed'; readonly message: string; readonly stale: boolean };

const VALIDATION_MESSAGE = 'Ingresá un porcentaje de 0 a 50, con hasta 2 decimales.';
const SERVER_REJECTED = 'El ahorro al agrupar piezas no es válido.';
const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const INITIAL_LOAD: LoadState = { kind: 'loading' };

function percentValidator(control: AbstractControl<string>): ValidationErrors | null {
  return parsePercentToBasisPoints(control.value) === null ? { invalid: true } : null;
}

@Component({
  selector: 'app-planning-settings-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './planning-settings-page.html',
  styleUrl: './planning-settings-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanningSettingsPage {
  private readonly api = inject(PlanningApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({
    saving: this.fb.control('', percentValidator),
  });

  protected readonly submitted = signal(false);
  protected readonly save = signal<SaveState>({ kind: 'idle' });
  protected readonly savedNotice = signal(false);
  /** The settings returned by the last successful save: they carry the newest version. */
  private readonly saved = signal<PlanningSettings | null>(null);

  private readonly loadRequests = new Subject<void>();

  /** Loads the settings; `switchMap` drops a superseded load (a second "Reintentar"). */
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

  /** True until the first save: the API answers 0 with version 0. */
  protected readonly neverSaved = computed(() => {
    const loaded = this.load();
    return loaded.kind === 'ready' && this.saved() === null && loaded.settings.version === 0;
  });

  protected fieldError(): string | null {
    const control = this.form.controls.saving;
    const errors = control.errors;
    if (errors === null || !(control.touched || this.submitted())) return null;
    return errors['server'] ? SERVER_REJECTED : VALIDATION_MESSAGE;
  }

  protected submit(): void {
    if (this.save().kind === 'saving') return;
    this.submitted.set(true);
    this.savedNotice.set(false);
    this.form.markAllAsTouched();
    if (this.load().kind !== 'ready') return;

    const batchSavingBasisPoints = parsePercentToBasisPoints(this.form.getRawValue().saving);
    if (batchSavingBasisPoints === null) {
      this.focusField();
      return;
    }

    const body: UpdatePlanningSettingsRequest = {
      batchSavingBasisPoints,
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
          'Alguien modificó este ajuste mientras lo editabas. Recargá para ver el valor actual; tus cambios sin guardar se van a perder.',
      });
      return;
    }

    if (
      error.status === 400 &&
      error.issues.some((issue) => issue.path === 'batchSavingBasisPoints')
    ) {
      this.form.controls.saving.setErrors({ server: true });
      this.save.set({ kind: 'idle' });
      this.focusField();
      return;
    }
    this.save.set({ kind: 'failed', message: error.message, stale: false });
  }

  private populate(settings: PlanningSettings): void {
    this.form.reset({ saving: basisPointsToPercentInput(settings.batchSavingBasisPoints) });
    this.submitted.set(false);
  }

  private focusField(): void {
    this.host.nativeElement.querySelector<HTMLElement>('#field-saving')?.focus();
  }
}
