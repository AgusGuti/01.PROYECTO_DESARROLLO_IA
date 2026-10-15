import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { CostsPickersApi } from './costs-pickers-api';

const BASE = 'http://api.test/api/v1';

function part(index: number) {
  return {
    id: `id-${String(index)}`,
    name: `Pieza ${String(index)}`,
    material: 'PLA',
    estimatedWeightGrams: 25,
  };
}

function pageBody(items: unknown[], total: number) {
  return { items, page: 1, pageSize: 100, total };
}

describe('CostsPickersApi', () => {
  let api: CostsPickersApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(CostsPickersApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  describe('project', () => {
    const body = {
      id: 'p1',
      name: 'Taller',
      description: null,
      items: [
        { partId: 'a', quantity: 3, part: { name: 'Soporte', material: 'PETG' } },
        { partId: 'b', quantity: 1, part: null },
      ],
    };

    it('gets the project by id and keeps its lines, with null for a deleted part', async () => {
      const result = firstValueFrom(api.project('p/1'));

      http.expectOne({ method: 'GET', url: `${BASE}/projects/p%2F1` }).flush(body);

      await expect(result).resolves.toEqual({
        id: 'p1',
        name: 'Taller',
        items: [
          { partId: 'a', quantity: 3, part: { name: 'Soporte', material: 'PETG' } },
          { partId: 'b', quantity: 1, part: null },
        ],
      });
    });

    it.each([
      ['no items list', { id: 'p1', name: 'x' }],
      [
        'a line with text quantity',
        { ...body, items: [{ partId: 'a', quantity: '1', part: null }] },
      ],
      [
        'an unknown material',
        { ...body, items: [{ partId: 'a', quantity: 1, part: { name: 'x', material: 'GOLD' } }] },
      ],
      ['a null body', null],
    ])('rejects a project with %s', async (_name, flushed) => {
      const result = firstValueFrom(api.project('p1'));

      http.expectOne(`${BASE}/projects/p1`).flush(flushed);

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });

    it('maps a 404 to an ApiError', async () => {
      const result = firstValueFrom(api.project('p1'));

      http
        .expectOne(`${BASE}/projects/p1`)
        .flush({ code: 'not_found' }, { status: 404, statusText: 'Not Found' });

      await expect(result).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('parts', () => {
    it('asks for 100 parts sorted by name and keeps only id, name and material', async () => {
      const result = firstValueFrom(api.parts());

      const request = http.expectOne((r) => r.url === `${BASE}/parts`);
      expect(request.request.params.get('page')).toBe('1');
      expect(request.request.params.get('pageSize')).toBe('100');
      expect(request.request.params.get('sort')).toBe('name');
      expect(request.request.params.get('order')).toBe('asc');
      request.flush(pageBody([part(1)], 1));

      await expect(result).resolves.toEqual({
        items: [{ id: 'id-1', name: 'Pieza 1', material: 'PLA' }],
        truncated: false,
      });
    });

    it('stops at 10 pages and says the catalogue was cut', async () => {
      const result = firstValueFrom(api.parts());

      for (let page = 1; page <= 10; page += 1) {
        http
          .expectOne((r) => r.url === `${BASE}/parts` && r.params.get('page') === String(page))
          .flush(pageBody([part(page)], 1500));
      }

      const catalogue = await result;
      expect(catalogue.items).toHaveLength(10);
      expect(catalogue.truncated).toBe(true);
      http.expectNone((r) => r.url === `${BASE}/parts` && r.params.get('page') === '11');
    });

    it('follows the pages until the total is covered', async () => {
      const result = firstValueFrom(api.parts());

      http.expectOne((r) => r.params.get('page') === '1').flush(pageBody([part(1)], 150));
      http.expectOne((r) => r.params.get('page') === '2').flush(pageBody([part(2)], 150));

      const catalogue = await result;
      expect(catalogue.items.map((item) => item.id)).toEqual(['id-1', 'id-2']);
      expect(catalogue.truncated).toBe(false);
    });

    it('rejects a part whose material is unknown', async () => {
      const result = firstValueFrom(api.parts());

      http
        .expectOne((r) => r.url === `${BASE}/parts`)
        .flush(pageBody([{ id: 'a', name: 'x', material: 'GOLD' }], 1));

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });

    it('maps a network failure to an ApiError', async () => {
      const result = firstValueFrom(api.parts());

      http.expectOne((r) => r.url === `${BASE}/parts`).error(new ProgressEvent('error'));

      await expect(result).rejects.toMatchObject({ code: 'network_error' });
    });
  });

  describe('filaments', () => {
    const spool = (id: string, availableGrams: number) => ({
      id,
      brand: 'Grilon3',
      colorName: 'Negro',
      material: 'PETG',
      initialGrams: 1000,
      availableGrams,
      purchaseCostMinor: 2_000_000,
      purchaseDate: '2026-01-01',
      version: 1,
    });

    it('filters by material on the server, sorted by brand, and keeps empty spools', async () => {
      const result = firstValueFrom(api.filaments('PETG'));

      const request = http.expectOne((r) => r.url === `${BASE}/filaments`);
      expect(request.request.params.get('material')).toBe('PETG');
      expect(request.request.params.get('sort')).toBe('brand');
      expect(request.request.params.get('order')).toBe('asc');
      expect(request.request.params.has('inStock')).toBe(false);
      request.flush(pageBody([spool('a', 0), spool('b', 400)], 2));

      await expect(result).resolves.toEqual({
        items: [
          { id: 'a', brand: 'Grilon3', colorName: 'Negro', material: 'PETG', availableGrams: 0 },
          { id: 'b', brand: 'Grilon3', colorName: 'Negro', material: 'PETG', availableGrams: 400 },
        ],
        truncated: false,
      });
    });

    it('rejects a spool with fractional grams', async () => {
      const result = firstValueFrom(api.filaments('PETG'));

      http.expectOne((r) => r.url === `${BASE}/filaments`).flush(pageBody([spool('a', 10.5)], 1));

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });
  });

  describe('printers', () => {
    const printer = (id: string, archivedAt: string | null, powerWatts: number | null) => ({
      id,
      name: `Impresora ${id}`,
      powerWatts,
      archivedAt,
    });

    it('drops printers pending removal and keeps their power', async () => {
      const result = firstValueFrom(api.printers());

      const request = http.expectOne((r) => r.url === `${BASE}/printers`);
      expect(request.request.params.get('sort')).toBe('name');
      request.flush(
        pageBody(
          [
            printer('a', null, 270),
            printer('b', '2026-10-01T00:00:00.000Z', 100),
            printer('c', null, null),
          ],
          3,
        ),
      );

      await expect(result).resolves.toEqual({
        items: [
          { id: 'a', name: 'Impresora a', powerWatts: 270 },
          { id: 'c', name: 'Impresora c', powerWatts: null },
        ],
        truncated: false,
      });
    });

    it('rejects a printer with a text power', async () => {
      const result = firstValueFrom(api.printers());

      http
        .expectOne((r) => r.url === `${BASE}/printers`)
        .flush(pageBody([{ id: 'a', name: 'x', powerWatts: '5', archivedAt: null }], 1));

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });
  });
});
