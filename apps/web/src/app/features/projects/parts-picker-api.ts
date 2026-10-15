import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Part } from '@print3d/api-contracts';
import { EMPTY, expand, map, type Observable, reduce } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isMaterial } from './project-labels';

/** What the project form needs to offer a part: nothing more is read from the response. */
export type PickerPart = Pick<Part, 'id' | 'name' | 'material'>;

export interface PickerCatalogue {
  readonly parts: readonly PickerPart[];
  /** True when the catalogue has more parts than the pages we are willing to read. */
  readonly truncated: boolean;
}

export const PICKER_PAGE_SIZE = 100;
export const PICKER_MAX_PAGES = 10;

interface PickerPage {
  readonly items: readonly PickerPart[];
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

function isPickerPart(value: unknown): value is PickerPart {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    isMaterial(value['material'])
  );
}

function readPage(body: unknown, requested: number): PickerPage {
  if (
    !isRecord(body) ||
    !Array.isArray(body['items']) ||
    !body['items'].every(isPickerPart) ||
    !isWholeNumber(body['pageSize']) ||
    !isWholeNumber(body['total'])
  ) {
    throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
  }
  const items: PickerPart[] = body['items'].map(({ id, name, material }) => ({
    id,
    name,
    material,
  }));
  return { items, pageSize: body['pageSize'], total: body['total'], requested };
}

const hasMore = (page: PickerPage): boolean => page.requested * page.pageSize < page.total;

/**
 * A small copy of the parts list call, kept here because a feature never imports from another
 * feature. It reads the whole catalogue (page after page, sorted by name) so the form can offer
 * every part in one `<select>`.
 */
@Injectable({ providedIn: 'root' })
export class PartsPickerApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private page(number: number): Observable<PickerPage> {
    const params = new HttpParams()
      .set('page', number)
      .set('pageSize', PICKER_PAGE_SIZE)
      .set('sort', 'name')
      .set('order', 'asc');
    return this.http
      .get<unknown>(`${this.baseUrl}/api/v1/parts`, { params })
      .pipe(map((body) => readPage(body, number)));
  }

  /** Follows the pages until the total is covered, or the cap is reached. */
  loadAll(): Observable<PickerCatalogue> {
    return this.page(1).pipe(
      expand((page) =>
        hasMore(page) && page.requested < PICKER_MAX_PAGES ? this.page(page.requested + 1) : EMPTY,
      ),
      reduce<PickerPage, PickerCatalogue>(
        (all, page) => ({ parts: [...all.parts, ...page.items], truncated: hasMore(page) }),
        { parts: [], truncated: false },
      ),
    );
  }
}
