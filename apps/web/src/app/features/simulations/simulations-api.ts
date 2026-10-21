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

const isGrams = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const GOALS: readonly unknown[] = ['deadline', 'fastest', 'minimal_idle'];
const WARNINGS: readonly unknown[] = [
  'part_deleted',
  'printer_unavailable',
  'availability_not_configured',
  'nothing_to_print',
  'batching_applied',
  'filament_insufficient',
  'filament_deleted',
];
const DEADLINE_CHANGES: readonly unknown[] = ['gained', 'lost', 'same', 'unknown'];

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): boolean => value === null || isText(value);
const isFlagOrNull = (value: unknown): boolean => value === null || typeof value === 'boolean';

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
    isTextOrNull(value['filamentId']) &&
    isTextOrNull(value['filamentName']) &&
    isCount(value['setupMinutes']) &&
    typeof value['filamentChanged'] === 'boolean' &&
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
    isCount(value['idleMinutes']) &&
    isCount(value['setupMinutes']) &&
    isCount(value['filamentChanges'])
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
    isTextOrNull(value['filamentId']) &&
    isTextOrNull(value['filamentName']) &&
    isCount(value['setupMinutes']) &&
    typeof value['filamentChanged'] === 'boolean' &&
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
    isCount(value['totalIdleMinutes']) &&
    isCount(value['totalSetupMinutes']) &&
    isCount(value['filamentChanges'])
  );
}

function isShortfall(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value['filamentId']) &&
    isText(value['name']) &&
    isGrams(value['availableGrams']) &&
    isGrams(value['neededGrams']) &&
    isCount(value['completablePieces']) &&
    isCount(value['remainingPieces'])
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
    isCount(value['totalSetupMinutes']) &&
    isCount(value['filamentChanges']) &&
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
    value['warnings'].every((one: unknown) => isRecord(one) && WARNINGS.includes(one['code'])) &&
    Array.isArray(value['filamentShortfalls']) &&
    value['filamentShortfalls'].every(isShortfall)
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
    isCount(totals['totalSetupMinutes']) &&
    isCount(totals['filamentChanges']) &&
    isRecord(deadline) &&
    (deadline['date'] === null || typeof deadline['date'] === 'string') &&
    (deadline['met'] === null || typeof deadline['met'] === 'boolean') &&
    Array.isArray(value['unplaced']) &&
    value['unplaced'].every(isUnplaced) &&
    Array.isArray(value['warnings']) &&
    value['warnings'].every((one: unknown) => isRecord(one) && WARNINGS.includes(one['code'])) &&
    Array.isArray(value['filamentShortfalls']) &&
    value['filamentShortfalls'].every(isShortfall)
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
