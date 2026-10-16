import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { PlanningSettings, UpdatePlanningSettingsRequest } from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Type guard: `HttpClient` only claims a body has a type, nothing checks it (standard §9.3). */
export function isPlanningSettings(value: unknown): value is PlanningSettings {
  return (
    isRecord(value) &&
    isCount(value['batchSavingBasisPoints']) &&
    isCount(value['version']) &&
    (value['updatedAt'] === null || typeof value['updatedAt'] === 'string')
  );
}

function narrow(body: unknown): PlanningSettings {
  if (!isPlanningSettings(body)) {
    throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
  }
  return body;
}

@Injectable({ providedIn: 'root' })
export class PlanningApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private get settingsUrl(): string {
    return `${this.baseUrl}/api/v1/planning/settings`;
  }

  getSettings(): Observable<PlanningSettings> {
    return this.http.get<unknown>(this.settingsUrl).pipe(map(narrow));
  }

  /** `body.version` is the version last seen, 0 for the first save (ADR 0027). Never retried. */
  putSettings(body: UpdatePlanningSettingsRequest): Observable<PlanningSettings> {
    return this.http.put<unknown>(this.settingsUrl, body).pipe(map(narrow));
  }
}
