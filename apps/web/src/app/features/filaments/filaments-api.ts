import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ConsumeFilamentRequest,
  CreateFilamentRequest,
  Filament,
  FilamentList,
  ListFilamentsData,
  UpdateFilamentRequest,
} from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isIsoDate, isMaterial } from './filament-labels';

export type ListFilamentsQuery = NonNullable<ListFilamentsData['query']>;

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
export function isFilament(value: unknown): value is Filament {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['brand'] === 'string' &&
    isMaterial(value['material']) &&
    typeof value['colorName'] === 'string' &&
    isWholeNumber(value['initialGrams']) &&
    isWholeNumber(value['availableGrams']) &&
    isWholeNumber(value['purchaseCostMinor']) &&
    isIsoDate(value['purchaseDate']) &&
    isWholeNumber(value['version']) &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

export function isFilamentList(value: unknown): value is FilamentList {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isFilament) &&
    isWholeNumber(value['page']) &&
    isWholeNumber(value['pageSize']) &&
    isWholeNumber(value['total'])
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
export class FilamentsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private get collectionUrl(): string {
    return `${this.baseUrl}/api/v1/filaments`;
  }

  private itemUrl(id: string): string {
    return `${this.collectionUrl}/${encodeURIComponent(id)}`;
  }

  list(query: ListFilamentsQuery = {}): Observable<FilamentList> {
    let params = new HttpParams();
    if (query.page !== undefined) params = params.set('page', query.page);
    if (query.pageSize !== undefined) params = params.set('pageSize', query.pageSize);
    if (query.material !== undefined) params = params.set('material', query.material);
    if (query.inStock !== undefined) params = params.set('inStock', query.inStock);
    if (query.sort !== undefined) params = params.set('sort', query.sort);
    if (query.order !== undefined) params = params.set('order', query.order);

    return this.http.get<unknown>(this.collectionUrl, { params }).pipe(map(narrow(isFilamentList)));
  }

  get(id: string): Observable<Filament> {
    return this.http.get<unknown>(this.itemUrl(id)).pipe(map(narrow(isFilament)));
  }

  /** Not idempotent (two POSTs make two spools): never retried automatically. */
  create(body: CreateFilamentRequest): Observable<Filament> {
    return this.http.post<unknown>(this.collectionUrl, body).pipe(map(narrow(isFilament)));
  }

  /** `body.version` is the version the caller last saw (ADR 0008). */
  update(id: string, body: UpdateFilamentRequest): Observable<Filament> {
    return this.http.patch<unknown>(this.itemUrl(id), body).pipe(map(narrow(isFilament)));
  }

  /** Answers 204. A second DELETE answers 404: there is no archived state (ADR 0012). */
  remove(id: string): Observable<void> {
    return this.http.delete<unknown>(this.itemUrl(id)).pipe(map(() => undefined));
  }

  /**
   * Takes grams off the spool with one atomic decrement (ADR 0010). Needs no version. Not
   * idempotent: a repeat would take the grams twice, so it is never retried automatically.
   */
  consume(id: string, grams: number): Observable<Filament> {
    const body: ConsumeFilamentRequest = { grams };
    return this.http
      .post<unknown>(`${this.itemUrl(id)}/consume`, body)
      .pipe(map(narrow(isFilament)));
  }
}
