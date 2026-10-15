import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Filament, Material, Part, Printer } from '@print3d/api-contracts';
import { EMPTY, expand, map, type Observable, reduce } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isMaterial } from './cost-labels';

/** What the calculator needs to offer each choice: nothing more is read from the responses. */
export type PickerPart = Pick<Part, 'id' | 'name' | 'material'>;
export type PickerFilament = Pick<
  Filament,
  'id' | 'brand' | 'colorName' | 'material' | 'availableGrams'
>;
export type PickerPrinter = Pick<Printer, 'id' | 'name' | 'powerWatts'>;

export interface PickerCatalogue<T> {
  readonly items: readonly T[];
  /** True when there are more rows than the pages we are willing to read. */
  readonly truncated: boolean;
}

/** A project as the cost page needs it; `part` is null when the part was deleted. */
export interface PickerProject {
  readonly id: string;
  readonly name: string;
  readonly items: readonly {
    readonly partId: string;
    readonly quantity: number;
    readonly part: { readonly name: string; readonly material: Material } | null;
  }[];
}

export const PICKER_PAGE_SIZE = 100;
export const PICKER_MAX_PAGES = 10;

interface RawPage<T> {
  readonly items: readonly T[];
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

function unexpected(): ApiError {
  return new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
}

function pickPart(value: unknown): PickerPart | null {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    !isMaterial(value['material'])
  ) {
    return null;
  }
  return { id: value['id'], name: value['name'], material: value['material'] };
}

function pickFilament(value: unknown): PickerFilament | null {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['brand'] !== 'string' ||
    typeof value['colorName'] !== 'string' ||
    !isMaterial(value['material']) ||
    !isWholeNumber(value['availableGrams'])
  ) {
    return null;
  }
  return {
    id: value['id'],
    brand: value['brand'],
    colorName: value['colorName'],
    material: value['material'],
    availableGrams: value['availableGrams'],
  };
}

/** A printer waiting to be removed (`archivedAt` set) comes back as `undefined`: skip it. */
function pickPrinter(value: unknown): PickerPrinter | null | undefined {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    !(value['powerWatts'] === null || isWholeNumber(value['powerWatts'])) ||
    !(value['archivedAt'] === null || typeof value['archivedAt'] === 'string')
  ) {
    return null;
  }
  if (value['archivedAt'] !== null) return undefined;
  return { id: value['id'], name: value['name'], powerWatts: value['powerWatts'] };
}

function pickProject(value: unknown): PickerProject | null {
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['name'] !== 'string') {
    return null;
  }
  if (!Array.isArray(value['items'])) return null;
  const items: PickerProject['items'][number][] = [];
  for (const row of value['items'] as unknown[]) {
    if (!isRecord(row) || typeof row['partId'] !== 'string' || !isWholeNumber(row['quantity'])) {
      return null;
    }
    const part = row['part'];
    if (part === null) {
      items.push({ partId: row['partId'], quantity: row['quantity'], part: null });
    } else if (isRecord(part) && typeof part['name'] === 'string' && isMaterial(part['material'])) {
      items.push({
        partId: row['partId'],
        quantity: row['quantity'],
        part: { name: part['name'], material: part['material'] },
      });
    } else {
      return null;
    }
  }
  return { id: value['id'], name: value['name'], items };
}

const hasMore = (page: RawPage<unknown>): boolean => page.requested * page.pageSize < page.total;

/**
 * Small, paged copies of the list calls of other features, kept here because a feature never
 * imports from another feature. Each reads the whole catalogue (up to 10 pages of 100) so the
 * calculator can offer every choice in one `<select>`.
 */
@Injectable({ providedIn: 'root' })
export class CostsPickersApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** `pick` returns null for a malformed row, undefined for a valid row to leave out. */
  private loadAll<T>(
    path: string,
    query: Readonly<Record<string, string>>,
    pick: (row: unknown) => T | null | undefined,
  ): Observable<PickerCatalogue<T>> {
    const page = (requested: number): Observable<RawPage<T>> => {
      let params = new HttpParams().set('page', requested).set('pageSize', PICKER_PAGE_SIZE);
      for (const [key, value] of Object.entries(query)) params = params.set(key, value);
      return this.http.get<unknown>(`${this.baseUrl}${path}`, { params }).pipe(
        map((body) => {
          if (
            !isRecord(body) ||
            !Array.isArray(body['items']) ||
            !isWholeNumber(body['pageSize']) ||
            !isWholeNumber(body['total'])
          ) {
            throw unexpected();
          }
          const items: T[] = [];
          for (const row of body['items'] as unknown[]) {
            const picked = pick(row);
            if (picked === null) throw unexpected();
            if (picked !== undefined) items.push(picked);
          }
          return { items, pageSize: body['pageSize'], total: body['total'], requested };
        }),
      );
    };

    return page(1).pipe(
      expand((current) =>
        hasMore(current) && current.requested < PICKER_MAX_PAGES
          ? page(current.requested + 1)
          : EMPTY,
      ),
      reduce<RawPage<T>, PickerCatalogue<T>>(
        (all, current) => ({
          items: [...all.items, ...current.items],
          truncated: hasMore(current),
        }),
        { items: [], truncated: false },
      ),
    );
  }

  /** One project with its lines. A body of the wrong shape is an `unexpected_response`. */
  project(id: string): Observable<PickerProject> {
    return this.http.get<unknown>(`${this.baseUrl}/api/v1/projects/${encodeURIComponent(id)}`).pipe(
      map((body) => {
        const project = pickProject(body);
        if (project === null) throw unexpected();
        return project;
      }),
    );
  }

  parts(): Observable<PickerCatalogue<PickerPart>> {
    return this.loadAll('/api/v1/parts', { sort: 'name', order: 'asc' }, pickPart);
  }

  /** Spools of one material, by brand. Empty spools are kept: the page marks them. */
  filaments(material: Material): Observable<PickerCatalogue<PickerFilament>> {
    return this.loadAll(
      '/api/v1/filaments',
      { material, sort: 'brand', order: 'asc' },
      pickFilament,
    );
  }

  /** Active printers only; those pending removal are dropped here. */
  printers(): Observable<PickerCatalogue<PickerPrinter>> {
    return this.loadAll('/api/v1/printers', { sort: 'name', order: 'asc' }, pickPrinter);
  }
}
