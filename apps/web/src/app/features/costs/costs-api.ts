import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CostEstimate,
  CostEstimateRequest,
  CostSettings,
  UpdateCostSettingsRequest,
} from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isWarningCode } from './cost-labels';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Money and counts are integers: a fractional centavo means the response is not ours. */
function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasMinor(value: unknown, extra?: (record: Record<string, unknown>) => boolean): boolean {
  return isRecord(value) && isWholeNumber(value['costMinor']) && (extra?.(value) ?? true);
}

/**
 * Type guards. `HttpClient` only *claims* a body has a given type; nothing checks it. These
 * functions are the runtime check (standard §9.3).
 */
export function isCostSettings(value: unknown): value is CostSettings {
  return (
    isRecord(value) &&
    isWholeNumber(value['kwhPriceMinor']) &&
    isWholeNumber(value['wearPerHourMinor']) &&
    isWholeNumber(value['fixedPerJobMinor']) &&
    isWholeNumber(value['defaultMarginBasisPoints']) &&
    isWholeNumber(value['version']) &&
    (value['updatedAt'] === null || typeof value['updatedAt'] === 'string')
  );
}

export function isCostEstimate(value: unknown): value is CostEstimate {
  if (!isRecord(value)) return false;
  const { filament, electricity, wear, fixed, warnings } = value;
  return (
    isWholeNumber(value['quantity']) &&
    isWholeNumber(value['printSeconds']) &&
    hasMinor(filament, (f) => typeof f['grams'] === 'number' && Number.isFinite(f['grams'])) &&
    (electricity === null || hasMinor(electricity, (e) => isWholeNumber(e['watts']))) &&
    hasMinor(wear) &&
    hasMinor(fixed) &&
    isWholeNumber(value['subtotalMinor']) &&
    isWholeNumber(value['marginBasisPoints']) &&
    isWholeNumber(value['marginMinor']) &&
    isWholeNumber(value['totalMinor']) &&
    isWholeNumber(value['unitTotalMinor']) &&
    Array.isArray(warnings) &&
    warnings.every((warning: unknown) => isRecord(warning) && isWarningCode(warning['code']))
  );
}

function narrow<T>(guard: (value: unknown) => value is T): (body: unknown) => T {
  return (body) => {
    if (!guard(body)) {
      throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
    }
    return body;
  };
}

@Injectable({ providedIn: 'root' })
export class CostsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private get settingsUrl(): string {
    return `${this.baseUrl}/api/v1/costs/settings`;
  }

  getSettings(): Observable<CostSettings> {
    return this.http.get<unknown>(this.settingsUrl).pipe(map(narrow(isCostSettings)));
  }

  /** `body.version` is the version last seen, 0 for the first save (ADR 0021). */
  putSettings(body: UpdateCostSettingsRequest): Observable<CostSettings> {
    return this.http.put<unknown>(this.settingsUrl, body).pipe(map(narrow(isCostSettings)));
  }

  /**
   * A POST that stores nothing (ADR 0020). It is still never retried automatically: the user
   * decides whether to press "Calcular" again.
   */
  estimate(body: CostEstimateRequest): Observable<CostEstimate> {
    return this.http
      .post<unknown>(`${this.baseUrl}/api/v1/costs/estimates`, body)
      .pipe(map(narrow(isCostEstimate)));
  }
}
