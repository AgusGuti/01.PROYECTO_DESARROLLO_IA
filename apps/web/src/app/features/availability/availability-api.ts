import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { InterventionSchedule, UpdateScheduleRequest } from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value['startMinute']) &&
    Number.isInteger(value['endMinute'])
  );
}

function isRangeList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isRange);
}

/**
 * `HttpClient` only *claims* a body has a given type; this is the runtime check (standard §9.3).
 */
export function isInterventionSchedule(value: unknown): value is InterventionSchedule {
  if (!isRecord(value)) return false;
  const { weekly, exceptions, version, updatedAt } = value;
  return (
    Array.isArray(weekly) &&
    weekly.length === 7 &&
    weekly.every((day: unknown) => isRecord(day) && isRangeList(day['ranges'])) &&
    Array.isArray(exceptions) &&
    exceptions.every(
      (item: unknown) =>
        isRecord(item) && typeof item['date'] === 'string' && isRangeList(item['ranges']),
    ) &&
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= 0 &&
    (updatedAt === null || typeof updatedAt === 'string')
  );
}

function narrow(body: unknown): InterventionSchedule {
  if (!isInterventionSchedule(body)) {
    throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
  }
  return body;
}

@Injectable({ providedIn: 'root' })
export class AvailabilityApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private get scheduleUrl(): string {
    return `${this.baseUrl}/api/v1/availability/schedule`;
  }

  getSchedule(): Observable<InterventionSchedule> {
    return this.http.get<unknown>(this.scheduleUrl).pipe(map(narrow));
  }

  /** A full replacement; `body.version` is the version last seen, 0 for the first save (ADR 0024). */
  putSchedule(body: UpdateScheduleRequest): Observable<InterventionSchedule> {
    return this.http.put<unknown>(this.scheduleUrl, body).pipe(map(narrow));
  }
}
