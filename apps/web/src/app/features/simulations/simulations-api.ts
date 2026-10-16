import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Optimization, Simulation, SimulationRequest } from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isStrategy } from './simulation-labels';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const GOALS: readonly unknown[] = ['deadline', 'fastest', 'minimal_idle'];
const WARNINGS: readonly unknown[] = [
  'part_deleted',
  'printer_unavailable',
  'availability_not_configured',
  'nothing_to_print',
  'batching_applied',
];
const DEADLINE_CHANGES: readonly unknown[] = ['gained', 'lost', 'same', 'unknown'];

function isJob(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCount(value['order']) &&
    typeof value['partId'] === 'string' &&
    typeof value['partName'] === 'string' &&
    isCount(value['unit']) &&
    isCount(value['unitsInLine']) &&
    typeof value['printerId'] === 'string' &&
    typeof value['startAt'] === 'string' &&
    typeof value['endAt'] === 'string' &&
    typeof value['handoffAt'] === 'string' &&
    typeof value['unattended'] === 'boolean'
  );
}

function isPrinter(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['printerId'] === 'string' &&
    typeof value['name'] === 'string' &&
    isCount(value['jobs']) &&
    isCount(value['busyMinutes']) &&
    isCount(value['idleMinutes'])
  );
}

function isUnplaced(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['partId'] === 'string' &&
    typeof value['partName'] === 'string' &&
    isCount(value['units'])
  );
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): boolean => value === null || isText(value);
const isFlagOrNull = (value: unknown): boolean => value === null || typeof value === 'boolean';

function isPlate(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCount(value['order']) &&
    isText(value['partId']) &&
    isText(value['partName']) &&
    isCount(value['units']) &&
    isCount(value['plateIndex']) &&
    isCount(value['platesInLine']) &&
    isText(value['printerId']) &&
    isText(value['startAt']) &&
    isText(value['endAt']) &&
    isText(value['handoffAt']) &&
    typeof value['unattended'] === 'boolean'
  );
}

function isPlanTotals(value: unknown): boolean {
  return (
    isRecord(value) &&
    isCount(value['placedPlates']) &&
    isCount(value['placedUnits']) &&
    isCount(value['unplacedUnits']) &&
    isTextOrNull(value['finishAt']) &&
    isCount(value['totalBusyMinutes']) &&
    isCount(value['totalIdleMinutes'])
  );
}

function isDeadline(value: unknown): boolean {
  return isRecord(value) && isTextOrNull(value['date']) && isFlagOrNull(value['met']);
}

function isBaseline(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPlanTotals(value['totals']) &&
    isDeadline(value['deadline']) &&
    Array.isArray(value['unplaced']) &&
    value['unplaced'].every(isUnplaced)
  );
}

function isCandidate(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStrategy(value['strategy']) &&
    isTextOrNull(value['finishAt']) &&
    isCount(value['totalIdleMinutes']) &&
    isFlagOrNull(value['deadlineMet']) &&
    isCount(value['placedUnits']) &&
    isCount(value['unplacedUnits'])
  );
}

function isOptimizedPlan(value: unknown): boolean {
  return (
    isBaseline(value) &&
    isRecord(value) &&
    Array.isArray(value['jobs']) &&
    value['jobs'].every(isPlate) &&
    Array.isArray(value['printers']) &&
    value['printers'].every(isPrinter)
  );
}

function isComparison(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value['finishDeltaMinutes'] === null || Number.isInteger(value['finishDeltaMinutes'])) &&
    Number.isInteger(value['idleDeltaMinutes']) &&
    DEADLINE_CHANGES.includes(value['deadlineChanged'])
  );
}

export function isOptimization(value: unknown): value is Optimization {
  return (
    isRecord(value) &&
    isText(value['projectId']) &&
    GOALS.includes(value['goal']) &&
    isText(value['startAt']) &&
    isStrategy(value['strategy']) &&
    isBaseline(value['baseline']) &&
    isOptimizedPlan(value['optimized']) &&
    isComparison(value['comparison']) &&
    Array.isArray(value['candidates']) &&
    value['candidates'].every(isCandidate) &&
    Array.isArray(value['warnings']) &&
    value['warnings'].every((one: unknown) => isRecord(one) && WARNINGS.includes(one['code']))
  );
}

/** Type guard: `HttpClient` only claims a body has a type, nothing checks it (standard §9.3). */
export function isSimulation(value: unknown): value is Simulation {
  if (!isRecord(value)) return false;
  const totals = value['totals'];
  const deadline = value['deadline'];
  return (
    typeof value['projectId'] === 'string' &&
    GOALS.includes(value['goal']) &&
    typeof value['startAt'] === 'string' &&
    Array.isArray(value['jobs']) &&
    value['jobs'].every(isJob) &&
    Array.isArray(value['printers']) &&
    value['printers'].every(isPrinter) &&
    isRecord(totals) &&
    isCount(totals['placedJobs']) &&
    isCount(totals['unplacedJobs']) &&
    (totals['finishAt'] === null || typeof totals['finishAt'] === 'string') &&
    isCount(totals['totalBusyMinutes']) &&
    isCount(totals['totalIdleMinutes']) &&
    isRecord(deadline) &&
    (deadline['date'] === null || typeof deadline['date'] === 'string') &&
    (deadline['met'] === null || typeof deadline['met'] === 'boolean') &&
    Array.isArray(value['unplaced']) &&
    value['unplaced'].every(isUnplaced) &&
    Array.isArray(value['warnings']) &&
    value['warnings'].every((one: unknown) => isRecord(one) && WARNINGS.includes(one['code']))
  );
}

@Injectable({ providedIn: 'root' })
export class SimulationsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** A POST that only computes: nothing is stored. Never retried automatically. */
  simulate(body: SimulationRequest): Observable<Simulation> {
    return this.http.post<unknown>(`${this.baseUrl}/api/v1/simulations`, body).pipe(
      map((result) => {
        if (!isSimulation(result)) {
          throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
        }
        return result;
      }),
    );
  }

  /** Also only computes (ADR 0028) and is never retried automatically. */
  optimize(body: SimulationRequest): Observable<Optimization> {
    return this.http.post<unknown>(`${this.baseUrl}/api/v1/simulations/optimizations`, body).pipe(
      map((result) => {
        if (!isOptimization(result)) {
          throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
        }
        return result;
      }),
    );
  }
}
