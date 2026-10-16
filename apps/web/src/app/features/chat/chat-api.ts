import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { ChatRequest, ChatResponse } from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';

/** Runtime check: `HttpClient` only claims the body is a ChatResponse (standard §9.3). */
export function isChatResponse(value: unknown): value is ChatResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['reply'] === 'string'
  );
}

@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** A POST that spends model time: never retried automatically, the user decides. */
  ask(message: string): Observable<string> {
    const body: ChatRequest = { message };
    return this.http.post<unknown>(`${this.baseUrl}/api/v1/chat`, body).pipe(
      map((response) => {
        if (!isChatResponse(response)) {
          throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
        }
        return response.reply;
      }),
    );
  }
}
