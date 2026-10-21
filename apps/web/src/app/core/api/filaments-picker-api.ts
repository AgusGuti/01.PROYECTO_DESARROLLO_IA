import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Filament } from '@print3d/api-contracts';
import { EMPTY, expand, map, type Observable, reduce } from 'rxjs';
import { API_BASE_URL } from './api-config';
import { ApiError } from './api-error';

/** What the project form needs to offer a spool: nothing more is read from the response. */
export type PickerSpool = Pick<Filament, 'id' | 'brand' | 'colorName' | 'availableGrams'> & {
  /** Only shown as text, so a string is enough (core cannot import a feature's material list). */
  readonly material: string;
};

export interface SpoolCatalogue {
  readonly spools: readonly PickerSpool[];
  /** True when there are more spools than the pages we are willing to read. */
  readonly truncated: boolean;
}

export const SPOOL_PAGE_SIZE = 100;
export const SPOOL_MAX_PAGES = 10;

interface SpoolPage {
  readonly items: readonly PickerSpool[];
  readonly pageSize: number;
  readonly total: number;
  /** The page we asked for, not the one the server claims: the loop must always end. */
  readonly requested: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isPickerSpool(value: unknown): value is PickerSpool {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['brand'] === 'string' &&
    typeof value['material'] === 'string' &&
    typeof value['colorName'] === 'string' &&
    isWholeNumber(value['availableGrams'])
  );
}

function readPage(body: unknown, requested: number): SpoolPage {
  if (
    !isRecord(body) ||
    !Array.isArray(body['items']) ||
    !body['items'].every(isPickerSpool) ||
    !isWholeNumber(body['pageSize']) ||
    !isWholeNumber(body['total'])
  ) {
    throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
  }
  const items: PickerSpool[] = body['items'].map(
    ({ id, brand, material, colorName, availableGrams }) => ({
      id,
      brand,
      material,
      colorName,
      availableGrams,
    }),
  );
  return { items, pageSize: body['pageSize'], total: body['total'], requested };
}

const hasMore = (page: SpoolPage): boolean => page.requested * page.pageSize < page.total;

/**
 * Shared by the features that offer a spool in a select (a feature never imports another). It
 * reads every live spool, page after page, sorted by brand.
 */
@Injectable({ providedIn: 'root' })
export class FilamentsPickerApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private page(number: number): Observable<SpoolPage> {
    const params = new HttpParams()
      .set('page', number)
      .set('pageSize', SPOOL_PAGE_SIZE)
      .set('sort', 'brand')
      .set('order', 'asc');
    return this.http
      .get<unknown>(`${this.baseUrl}/api/v1/filaments`, { params })
      .pipe(map((body) => readPage(body, number)));
  }

  /** Follows the pages until the total is covered, or the cap is reached. */
  loadAll(): Observable<SpoolCatalogue> {
    return this.page(1).pipe(
      expand((page) =>
        hasMore(page) && page.requested < SPOOL_MAX_PAGES ? this.page(page.requested + 1) : EMPTY,
      ),
      reduce<SpoolPage, SpoolCatalogue>(
        (all, page) => ({ spools: [...all.spools, ...page.items], truncated: hasMore(page) }),
        { spools: [], truncated: false },
      ),
    );
  }
}
