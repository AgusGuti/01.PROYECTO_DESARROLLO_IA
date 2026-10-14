import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Readiness } from '@print3d/api-contracts';
import { catchError, map, type Observable, of, throwError } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';

/**
 * Type guard. `HttpClient.get<T>()` only *claims* the response is a T; nothing checks it.
 * This function is the runtime check (standard §9.3).
 */
export function isReadiness(value: unknown): value is Readiness {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const checks = candidate['checks'];
  return (
    (candidate['status'] === 'ready' || candidate['status'] === 'not_ready') &&
    typeof candidate['timestamp'] === 'string' &&
    typeof checks === 'object' &&
    checks !== null &&
    ['up', 'down'].includes((checks as Record<string, unknown>)['database'] as string)
  );
}

@Injectable({ providedIn: 'root' })
export class StatusApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** Emits the readiness report. "Not ready" is a normal answer here, not an error. */
  readiness(): Observable<Readiness> {
    return this.http.get<unknown>(`${this.baseUrl}/health/ready`).pipe(
      map((body) => {
        if (!isReadiness(body)) {
          throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
        }
        return body;
      }),
      // The API answers 503 with a readiness body when a dependency is down.
      catchError((error: unknown) =>
        error instanceof ApiError && error.status === 503 && isReadiness(error.body)
          ? of(error.body)
          : throwError(() => error),
      ),
    );
  }
}
