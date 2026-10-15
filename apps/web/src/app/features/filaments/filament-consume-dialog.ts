import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Filament } from '@print3d/api-contracts';
import { catchError, map, of } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { FilamentsApi } from './filaments-api';

const MAX_GRAMS = 20_000;
const GRAMS_INPUT = /^\d{1,5}$/;

const INVALID_GRAMS = `Ingresá un número entero de gramos, entre 1 y ${String(MAX_GRAMS)}.`;
const GENERIC_FAILURE = 'No se pudo descontar el material. Intentá de nuevo.';
const NOT_ENOUGH_UNKNOWN = 'No hay material suficiente. Actualizá la lista e intentá de nuevo.';

type Outcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'short'; readonly left: number }
  | { readonly kind: 'shortUnknown' }
  | { readonly kind: 'failed' };

function isNotEnough(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.issues.some((issue) => issue.path === 'grams')
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Takes grams off a spool. It uses the native <dialog> element (see the delete dialog) and owns
 * its request, because the answer decides whether the dialog stays open: a 409 keeps it open
 * with the grams that are really left. The consume is never retried automatically: a retry
 * would take the grams twice (ADR 0010).
 */
@Component({
  selector: 'app-filament-consume-dialog',
  templateUrl: './filament-consume-dialog.html',
  styleUrl: './filament-consume-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilamentConsumeDialog {
  private readonly api = inject(FilamentsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly filament = input.required<Filament>();

  /** The grams were taken. The parent closes the dialog, announces it and reloads. */
  readonly consumed = output<number>();
  /** The filament no longer exists. */
  readonly gone = output();
  /** The stored data changed under the dialog, which stays open: reload the list. */
  readonly refresh = output();
  readonly cancelled = output();

  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Grams left according to the last re-read; null until a 409 forced one. */
  private readonly freshAvailable = signal<number | null>(null);
  /** Only a hint for the `max` attribute: the API decides. */
  protected readonly maxGrams = computed(
    () => this.freshAvailable() ?? this.filament().availableGrams,
  );

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly gramsInput = viewChild.required<ElementRef<HTMLInputElement>>('gramsInput');

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      this.gramsInput().nativeElement.focus();
    });
  }

  protected onCancelEvent(event: Event): void {
    // Stop the browser from closing the element itself; the parent owns the open state.
    event.preventDefault();
    if (!this.sending()) this.cancelled.emit();
  }

  protected confirm(event: Event): void {
    event.preventDefault();
    // Set synchronously, so a second click before the next render finds it already true.
    if (this.sending()) return;

    const text = this.gramsInput().nativeElement.value.trim();
    const grams = GRAMS_INPUT.test(text) ? Number(text) : 0;
    if (grams < 1 || grams > MAX_GRAMS) {
      this.error.set(INVALID_GRAMS);
      this.gramsInput().nativeElement.focus();
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    this.api
      .consume(this.filament().id, grams)
      .pipe(
        map((): Outcome => ({ kind: 'done' })),
        // A 409 carries no numbers (ADR 0010): read the filament again to say what is left.
        catchError((failure: unknown) => {
          if (isNotFound(failure)) return of<Outcome>({ kind: 'gone' });
          if (!isNotEnough(failure)) return of<Outcome>({ kind: 'failed' });
          return this.api.get(this.filament().id).pipe(
            map((fresh): Outcome => ({ kind: 'short', left: fresh.availableGrams })),
            catchError((reread: unknown) =>
              of<Outcome>(isNotFound(reread) ? { kind: 'gone' } : { kind: 'shortUnknown' }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcome) => {
        this.sending.set(false);
        switch (outcome.kind) {
          case 'done':
            this.consumed.emit(grams);
            return;
          case 'gone':
            this.gone.emit();
            return;
          case 'short':
            this.freshAvailable.set(outcome.left);
            this.fail(`No hay material suficiente: quedan ${String(outcome.left)} g.`);
            return;
          case 'shortUnknown':
            this.fail(NOT_ENOUGH_UNKNOWN);
            return;
          case 'failed':
            this.fail(GENERIC_FAILURE);
            return;
        }
      });
  }

  private fail(message: string): void {
    this.error.set(message);
    this.refresh.emit();
    // The button that was pressed is disabled while sending: put focus back on the field.
    afterNextRender(
      () => {
        this.gramsInput().nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
