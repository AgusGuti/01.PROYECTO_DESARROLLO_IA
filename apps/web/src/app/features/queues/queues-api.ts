import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CreateQueueRequest,
  Queue,
  QueueLine,
  UpdateQueueRequest,
} from '@print3d/api-contracts';
import { catchError, map, of, type Observable, throwError } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isGoal, isMode } from './queue-labels';

/** A live printer the user may pick. */
export interface PrinterOption {
  readonly id: string;
  readonly name: string;
}

/** The lines a new queue starts from; `name` is null when the part was deleted. */
export interface ProjectSnapshot {
  readonly name: string;
  readonly lines: readonly {
    readonly partId: string;
    readonly name: string | null;
    readonly quantity: number;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function unexpected(): ApiError {
  return new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
}

function narrow<T>(guard: (value: unknown) => value is T): (body: unknown) => T {
  return (body) => {
    if (!guard(body)) throw unexpected();
    return body;
  };
}

function isQueueLine(value: unknown): value is QueueLine {
  return (
    isRecord(value) &&
    typeof value['partId'] === 'string' &&
    isWholeNumber(value['quantity']) &&
    isWholeNumber(value['completed']) &&
    isWholeNumber(value['pendingUnits']) &&
    (value['partName'] === null || typeof value['partName'] === 'string') &&
    (value['estimatedPrintSeconds'] === null || isWholeNumber(value['estimatedPrintSeconds'])) &&
    typeof value['partDeleted'] === 'boolean'
  );
}

/** Type guard: `HttpClient` only claims a body has a type, nothing checks it (standard §9.3). */
export function isQueue(value: unknown): value is Queue {
  if (!isRecord(value)) return false;
  const totals = value['totals'];
  return (
    typeof value['projectId'] === 'string' &&
    isGoal(value['goal']) &&
    isMode(value['mode']) &&
    Array.isArray(value['printerIds']) &&
    value['printerIds'].every((id: unknown) => typeof id === 'string') &&
    Array.isArray(value['lines']) &&
    value['lines'].every(isQueueLine) &&
    isRecord(totals) &&
    isWholeNumber(totals['totalUnits']) &&
    isWholeNumber(totals['completedUnits']) &&
    isWholeNumber(totals['pendingUnits']) &&
    isWholeNumber(totals['pendingSeconds']) &&
    isWholeNumber(value['version']) &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

function pickPrinter(value: unknown): PrinterOption | null | undefined {
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['name'] !== 'string') {
    return null;
  }
  if (value['archivedAt'] !== null && value['archivedAt'] !== undefined) return undefined;
  return { id: value['id'], name: value['name'] };
}

function pickProject(value: unknown): ProjectSnapshot | null {
  if (!isRecord(value) || typeof value['name'] !== 'string' || !Array.isArray(value['items'])) {
    return null;
  }
  const lines: ProjectSnapshot['lines'][number][] = [];
  for (const row of value['items'] as unknown[]) {
    if (!isRecord(row) || typeof row['partId'] !== 'string' || !isWholeNumber(row['quantity'])) {
      return null;
    }
    const part = row['part'];
    let name: string | null = null;
    if (part !== null) {
      if (!isRecord(part) || typeof part['name'] !== 'string') return null;
      name = part['name'];
    }
    lines.push({ partId: row['partId'], name, quantity: row['quantity'] });
  }
  return { name: value['name'], lines };
}

@Injectable({ providedIn: 'root' })
export class QueuesApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private itemUrl(projectId: string): string {
    return `${this.baseUrl}/api/v1/queues/${encodeURIComponent(projectId)}`;
  }

  /** A 404 is not an error here: the project simply has no queue yet (null). */
  get(projectId: string): Observable<Queue | null> {
    return this.http.get<unknown>(this.itemUrl(projectId)).pipe(
      map(narrow(isQueue)),
      catchError((error: unknown) =>
        error instanceof ApiError && error.status === 404 ? of(null) : throwError(() => error),
      ),
    );
  }

  /** Not idempotent: never retried automatically. */
  create(body: CreateQueueRequest): Observable<Queue> {
    return this.http
      .post<unknown>(`${this.baseUrl}/api/v1/queues`, body)
      .pipe(map(narrow(isQueue)));
  }

  /** `body.version` is the version last seen (ADR 0025). */
  update(projectId: string, body: UpdateQueueRequest): Observable<Queue> {
    return this.http.patch<unknown>(this.itemUrl(projectId), body).pipe(map(narrow(isQueue)));
  }

  remove(projectId: string, version: number): Observable<void> {
    const params = new HttpParams().set('version', version);
    return this.http
      .delete<unknown>(this.itemUrl(projectId), { params })
      .pipe(map(() => undefined));
  }

  /**
   * Live printers, by name. Small copy of the printers read, kept here because a feature never
   * imports another. shortcut: first 100 only, upgrade if one workshop owns more printers.
   */
  printers(): Observable<readonly PrinterOption[]> {
    const params = new HttpParams()
      .set('page', 1)
      .set('pageSize', 100)
      .set('sort', 'name')
      .set('order', 'asc');
    return this.http.get<unknown>(`${this.baseUrl}/api/v1/printers`, { params }).pipe(
      map((body) => {
        if (!isRecord(body) || !Array.isArray(body['items'])) throw unexpected();
        const printers: PrinterOption[] = [];
        for (const row of body['items'] as unknown[]) {
          const picked = pickPrinter(row);
          if (picked === null) throw unexpected();
          if (picked !== undefined) printers.push(picked);
        }
        return printers;
      }),
    );
  }

  project(projectId: string): Observable<ProjectSnapshot> {
    return this.http
      .get<unknown>(`${this.baseUrl}/api/v1/projects/${encodeURIComponent(projectId)}`)
      .pipe(
        map((body) => {
          const project = pickProject(body);
          if (project === null) throw unexpected();
          return project;
        }),
      );
  }
}
