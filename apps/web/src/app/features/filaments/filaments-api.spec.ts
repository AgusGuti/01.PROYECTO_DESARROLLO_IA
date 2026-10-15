import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Filament, FilamentList } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { FilamentsApi, isFilament, isFilamentList } from './filaments-api';

const filament: Filament = {
  id: '66f0c0ffee0123456789abcd',
  brand: 'Grilon3',
  material: 'PLA',
  colorName: 'Negro',
  initialGrams: 1000,
  availableGrams: 800,
  purchaseCostMinor: 1500050,
  purchaseDate: '2026-10-01',
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};
const list: FilamentList = { items: [filament], page: 1, pageSize: 20, total: 1 };
const URL = 'http://api.test/api/v1/filaments';

describe('FilamentsApi', () => {
  let api: FilamentsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(FilamentsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lists filaments sending only the query parameters it was given', async () => {
    const result = firstValueFrom(
      api.list({ page: 2, pageSize: 20, material: 'PETG', inStock: 'true' }),
    );

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('20');
    expect(request.request.params.get('material')).toBe('PETG');
    expect(request.request.params.get('inStock')).toBe('true');
    expect(request.request.params.has('sort')).toBe(false);
    request.flush({ ...list, page: 2 });

    await expect(result).resolves.toMatchObject({ page: 2, total: 1 });
  });

  it('sends no inStock, material or sort parameter when none was asked for', async () => {
    const result = firstValueFrom(api.list({ page: 1, pageSize: 20 }));

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.params.keys().sort()).toEqual(['page', 'pageSize']);
    request.flush(list);

    await expect(result).resolves.toEqual(list);
  });

  it('gets one filament by id', async () => {
    const result = firstValueFrom(api.get(filament.id));

    http.expectOne({ method: 'GET', url: `${URL}/${filament.id}` }).flush(filament);

    await expect(result).resolves.toEqual(filament);
  });

  it('creates a filament with a POST and the given body', async () => {
    const body = {
      brand: 'Grilon3',
      material: 'PLA',
      colorName: 'Negro',
      initialGrams: 1000,
      purchaseCostMinor: 1500050,
      purchaseDate: '2026-10-01',
    } as const;
    const result = firstValueFrom(api.create(body));

    const request = http.expectOne({ method: 'POST', url: URL });
    expect(request.request.body).toEqual(body);
    request.flush(filament, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(filament);
  });

  it('updates a filament with a PATCH that carries the version', async () => {
    const result = firstValueFrom(api.update(filament.id, { version: 3, colorName: 'Blanco' }));

    const request = http.expectOne({ method: 'PATCH', url: `${URL}/${filament.id}` });
    expect(request.request.body).toEqual({ version: 3, colorName: 'Blanco' });
    request.flush({ ...filament, version: 4 });

    await expect(result).resolves.toMatchObject({ version: 4 });
  });

  it('removes a filament with a DELETE and completes on 204', async () => {
    const result = firstValueFrom(api.remove(filament.id));

    http
      .expectOne({ method: 'DELETE', url: `${URL}/${filament.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  describe('consume', () => {
    it('posts only the grams, with no version, and returns the updated filament', async () => {
      const result = firstValueFrom(api.consume(filament.id, 30));

      const request = http.expectOne({ method: 'POST', url: `${URL}/${filament.id}/consume` });
      expect(request.request.body).toEqual({ grams: 30 });
      request.flush({ ...filament, availableGrams: 770 });

      await expect(result).resolves.toMatchObject({ availableGrams: 770 });
    });

    it('maps a 409 on grams to an ApiError that keeps the issue path', async () => {
      const result = firstValueFrom(api.consume(filament.id, 5000));

      http.expectOne(`${URL}/${filament.id}/consume`).flush(
        {
          code: 'conflict',
          detail: 'backend text',
          issues: [{ path: 'grams', message: 'Not enough material.' }],
        },
        { status: 409, statusText: 'Conflict' },
      );

      const error: unknown = await result.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 409, issues: [{ path: 'grams' }] });
    });

    it('does not retry on its own after a failure', async () => {
      const result = firstValueFrom(api.consume(filament.id, 30));

      http.expectOne(`${URL}/${filament.id}/consume`).flush(null, {
        status: 503,
        statusText: 'Unavailable',
      });

      await expect(result).rejects.toBeInstanceOf(ApiError);
      http.expectNone(`${URL}/${filament.id}/consume`);
    });

    it('rejects a response that is not a filament', async () => {
      const result = firstValueFrom(api.consume(filament.id, 30));

      http.expectOne(`${URL}/${filament.id}/consume`).flush({ ok: true });

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });
  });

  it('rejects a list response that does not match the contract', async () => {
    const result = firstValueFrom(api.list());

    http
      .expectOne((r) => r.url === URL)
      .flush({ items: [{ ...filament, material: 'GOLD' }], page: 1, pageSize: 20, total: 1 });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('maps a version conflict to an ApiError that keeps the problem issues', async () => {
    const result = firstValueFrom(api.update(filament.id, { version: 1, brand: 'x' }));

    http.expectOne(`${URL}/${filament.id}`).flush(
      {
        code: 'conflict',
        detail: 'backend text',
        issues: [{ path: 'version', message: 'Does not match the current version.' }],
      },
      { status: 409, statusText: 'Conflict' },
    );

    const error: unknown = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'conflict',
      issues: [{ path: 'version', message: 'Does not match the current version.' }],
    });
  });

  it('fails with a network ApiError when the server cannot be reached', async () => {
    const result = firstValueFrom(api.list());

    http.expectOne((r) => r.url === URL).error(new ProgressEvent('error'));

    await expect(result).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('isFilament', () => {
  it('accepts a well-formed filament', () => {
    expect(isFilament(filament)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a material outside the catalog', { ...filament, material: 'GOLD' }],
    ['a fractional cost', { ...filament, purchaseCostMinor: 15000.5 }],
    ['a cost sent as text', { ...filament, purchaseCostMinor: '1500050' }],
    ['a full instant as the purchase date', { ...filament, purchaseDate: '2026-10-01T00:00:00Z' }],
    ['a date in another format', { ...filament, purchaseDate: '01/10/2026' }],
    ['an impossible date', { ...filament, purchaseDate: '2026-02-30' }],
    ['fractional grams', { ...filament, availableGrams: 10.5 }],
    ['a missing brand', { ...filament, brand: undefined }],
    ['a missing version', { ...filament, version: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(isFilament(value)).toBe(false);
  });
});

describe('isFilamentList', () => {
  it('accepts a page of filaments', () => {
    expect(isFilamentList(list)).toBe(true);
  });

  it('rejects a page with one malformed item or without paging numbers', () => {
    expect(isFilamentList({ ...list, items: [{ ...filament, id: 5 }] })).toBe(false);
    expect(isFilamentList({ items: [] })).toBe(false);
    expect(isFilamentList('nope')).toBe(false);
  });
});
