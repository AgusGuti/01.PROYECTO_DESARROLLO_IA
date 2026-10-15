import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CreatePartRequest,
  ListPartsData,
  Part,
  PartList,
  PartSource,
  PartUsage,
  UpdatePartRequest,
} from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isMaterial } from './part-labels';

export type ListPartsQuery = NonNullable<ListPartsData['query']>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isDimensions(value: unknown): boolean {
  return (
    isRecord(value) &&
    isWholeNumber(value['x']) &&
    isWholeNumber(value['y']) &&
    isWholeNumber(value['z'])
  );
}

function isPartSource(value: unknown): value is PartSource {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'manual') return true;
  return (
    value['kind'] === 'gcode' &&
    typeof value['fileName'] === 'string' &&
    value['slicer'] === 'cura' &&
    typeof value['analyzedAt'] === 'string'
  );
}

/**
 * Type guards. `HttpClient` only *claims* a body has a given type; nothing checks it. These
 * functions are the runtime check (standard §9.3).
 */
export function isPart(value: unknown): value is Part {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    (value['description'] === null || typeof value['description'] === 'string') &&
    isMaterial(value['material']) &&
    isDimensions(value['dimensionsMm']) &&
    isWholeNumber(value['estimatedWeightGrams']) &&
    isWholeNumber(value['estimatedPrintSeconds']) &&
    isWholeNumber(value['layerHeightUm']) &&
    (value['suggestedPrinterName'] === null || typeof value['suggestedPrinterName'] === 'string') &&
    isPartSource(value['source']) &&
    isWholeNumber(value['version']) &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

export function isPartList(value: unknown): value is PartList {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isPart) &&
    isWholeNumber(value['page']) &&
    isWholeNumber(value['pageSize']) &&
    isWholeNumber(value['total'])
  );
}

export function isPartUsage(value: unknown): value is PartUsage {
  return (
    isRecord(value) &&
    isWholeNumber(value['total']) &&
    Array.isArray(value['projects']) &&
    value['projects'].every(
      (project: unknown) =>
        isRecord(project) &&
        typeof project['id'] === 'string' &&
        typeof project['name'] === 'string' &&
        isWholeNumber(project['quantity']),
    )
  );
}

export function narrow<T>(guard: (value: unknown) => value is T): (body: unknown) => T {
  return (body) => {
    if (!guard(body)) {
      throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
    }
    return body;
  };
}

@Injectable({ providedIn: 'root' })
export class PartsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private get collectionUrl(): string {
    return `${this.baseUrl}/api/v1/parts`;
  }

  private itemUrl(id: string): string {
    return `${this.collectionUrl}/${encodeURIComponent(id)}`;
  }

  list(query: ListPartsQuery = {}): Observable<PartList> {
    let params = new HttpParams();
    if (query.page !== undefined) params = params.set('page', query.page);
    if (query.pageSize !== undefined) params = params.set('pageSize', query.pageSize);
    if (query.material !== undefined) params = params.set('material', query.material);
    if (query.sort !== undefined) params = params.set('sort', query.sort);
    if (query.order !== undefined) params = params.set('order', query.order);

    return this.http.get<unknown>(this.collectionUrl, { params }).pipe(map(narrow(isPartList)));
  }

  get(id: string): Observable<Part> {
    return this.http.get<unknown>(this.itemUrl(id)).pipe(map(narrow(isPart)));
  }

  /** Not idempotent (two POSTs make two parts): never retried automatically. */
  create(body: CreatePartRequest): Observable<Part> {
    return this.http.post<unknown>(this.collectionUrl, body).pipe(map(narrow(isPart)));
  }

  /** `body.version` is the version the caller last saw (ADR 0008). */
  update(id: string, body: UpdatePartRequest): Observable<Part> {
    return this.http.patch<unknown>(this.itemUrl(id), body).pipe(map(narrow(isPart)));
  }

  /**
   * Answers 204. A second DELETE answers 404: removal is logical but final for the client. A part
   * that live projects use answers 409 unless `removeFromProjects` is true (ADR 0018); the flag is
   * sent only when true.
   */
  remove(id: string, options: { readonly removeFromProjects?: boolean } = {}): Observable<void> {
    const params =
      options.removeFromProjects === true
        ? new HttpParams().set('removeFromProjects', 'true')
        : new HttpParams();
    return this.http.delete<unknown>(this.itemUrl(id), { params }).pipe(map(() => undefined));
  }

  /** The live projects that use the part: at most 50 of them, with the true total (ADR 0018). */
  usage(id: string): Observable<PartUsage> {
    return this.http.get<unknown>(`${this.itemUrl(id)}/usage`).pipe(map(narrow(isPartUsage)));
  }
}
