import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CreatePrinterRequest,
  ListPrintersData,
  Printer,
  PrinterList,
  UpdatePrinterRequest,
} from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isMaterial, isNozzleDiameter, isNozzleMaterial, isPrinterStatus } from './printer-labels';

export type ListPrintersQuery = NonNullable<ListPrintersData['query']>;

export interface CreatePrinterResult {
  readonly printer: Printer;
  /** True when a deleted printer was revived (HTTP 200) instead of created (201). */
  readonly restored: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Type guards. `HttpClient` only *claims* a body has a given type; nothing checks it. These
 * functions are the runtime check (standard §9.3).
 */
export function isPrinter(value: unknown): value is Printer {
  if (!isRecord(value)) return false;
  const { buildVolume, nozzle, compatibleMaterials, archivedAt } = value;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    isRecord(buildVolume) &&
    isWholeNumber(buildVolume['x']) &&
    isWholeNumber(buildVolume['y']) &&
    isWholeNumber(buildVolume['z']) &&
    isRecord(nozzle) &&
    isNozzleDiameter(nozzle['diameterMm']) &&
    isNozzleMaterial(nozzle['material']) &&
    Array.isArray(compatibleMaterials) &&
    compatibleMaterials.every(isMaterial) &&
    (value['typicalSpeedMmS'] === null || isWholeNumber(value['typicalSpeedMmS'])) &&
    isPrinterStatus(value['status']) &&
    isWholeNumber(value['version']) &&
    (archivedAt === null || typeof archivedAt === 'string') &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

export function isPrinterList(value: unknown): value is PrinterList {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isPrinter) &&
    isWholeNumber(value['page']) &&
    isWholeNumber(value['pageSize']) &&
    isWholeNumber(value['total'])
  );
}

function unexpectedResponse(): ApiError {
  return new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
}

function narrow<T>(guard: (value: unknown) => value is T): (body: unknown) => T {
  return (body) => {
    if (!guard(body)) throw unexpectedResponse();
    return body;
  };
}

@Injectable({ providedIn: 'root' })
export class PrintersApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private get collectionUrl(): string {
    return `${this.baseUrl}/api/v1/printers`;
  }

  private itemUrl(id: string): string {
    return `${this.collectionUrl}/${encodeURIComponent(id)}`;
  }

  list(query: ListPrintersQuery = {}): Observable<PrinterList> {
    let params = new HttpParams();
    if (query.page !== undefined) params = params.set('page', query.page);
    if (query.pageSize !== undefined) params = params.set('pageSize', query.pageSize);
    if (query.status !== undefined) params = params.set('status', query.status);
    if (query.sort !== undefined) params = params.set('sort', query.sort);
    if (query.order !== undefined) params = params.set('order', query.order);

    return this.http.get<unknown>(this.collectionUrl, { params }).pipe(map(narrow(isPrinterList)));
  }

  get(id: string): Observable<Printer> {
    return this.http.get<unknown>(this.itemUrl(id)).pipe(map(narrow(isPrinter)));
  }

  /**
   * Not idempotent: never retried automatically. `restoreIfDeleted` is sent only when asked
   * (ADR 0009); the API answers 201 for a new printer and 200 for a restored one.
   */
  create(
    body: CreatePrinterRequest,
    options: { readonly restoreIfDeleted?: boolean } = {},
  ): Observable<CreatePrinterResult> {
    const payload = options.restoreIfDeleted === true ? { ...body, restoreIfDeleted: true } : body;
    return this.http.post<unknown>(this.collectionUrl, payload, { observe: 'response' }).pipe(
      map((response) => ({
        printer: narrow(isPrinter)(response.body),
        restored: response.status === 200,
      })),
    );
  }

  /** Harmless and idempotent: an already active printer answers 200 as well. */
  unarchive(id: string): Observable<Printer> {
    return this.http
      .post<unknown>(`${this.itemUrl(id)}/unarchive`, {})
      .pipe(map(narrow(isPrinter)));
  }

  /** `body.version` is the version the caller last saw (ADR 0008). */
  update(id: string, body: UpdatePrinterRequest): Observable<Printer> {
    return this.http.patch<unknown>(this.itemUrl(id), body).pipe(map(narrow(isPrinter)));
  }

  /** Answers 204 both when the printer is deleted and when it is archived. */
  remove(id: string): Observable<void> {
    return this.http.delete<unknown>(this.itemUrl(id)).pipe(map(() => undefined));
  }
}
