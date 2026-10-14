import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { Readiness } from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { StatusApi } from './status-api';

/** Every state the page can be in. A union makes impossible combinations unrepresentable. */
type ViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly readiness: Readiness }
  | { readonly kind: 'failed'; readonly message: string };

const LOADING: ViewState = { kind: 'loading' };

@Component({
  selector: 'app-status-page',
  imports: [DatePipe],
  templateUrl: './status-page.html',
  styleUrl: './status-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusPage {
  private readonly api = inject(StatusApi);
  private readonly refreshRequests = new Subject<void>();

  /**
   * `switchMap` drops a request that is still in flight when a newer one starts, so a slow
   * old answer can never overwrite a fresh one. `toSignal` unsubscribes with the component.
   */
  protected readonly state = toSignal(
    this.refreshRequests.pipe(
      startWith(undefined),
      switchMap(() =>
        this.api.readiness().pipe(
          map((readiness): ViewState => ({ kind: 'loaded', readiness })),
          catchError((error: unknown) =>
            of<ViewState>({
              kind: 'failed',
              message:
                error instanceof ApiError
                  ? error.message
                  : 'Ocurrió un error inesperado. Intentá de nuevo.',
            }),
          ),
          startWith(LOADING),
        ),
      ),
    ),
    { initialValue: LOADING },
  );

  protected refresh(): void {
    this.refreshRequests.next();
  }
}
