import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { FilamentsPickerApi } from './filaments-picker-api';

const URL = 'http://api.test/api/v1/filaments';

/** A spool with extra fields the picker must ignore. */
function spool(index: number) {
  return {
    id: `f-${String(index)}`,
    brand: `Marca ${String(index)}`,
    material: 'PLA',
    colorName: 'Rojo',
    availableGrams: 500,
    purchaseCostMinor: 1_500_000,
  };
}

function pageBody(first: number, count: number, total: number) {
  return {
    items: Array.from({ length: count }, (_, offset) => spool(first + offset)),
    page: 1,
    pageSize: 100,
    total,
  };
}

describe('FilamentsPickerApi', () => {
  let api: FilamentsPickerApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(FilamentsPickerApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('asks for 100 spools sorted by brand and keeps only what the select needs', async () => {
    const result = firstValueFrom(api.loadAll());

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.params.get('pageSize')).toBe('100');
    expect(request.request.params.get('sort')).toBe('brand');
    request.flush(pageBody(1, 1, 1));

    await expect(result).resolves.toEqual({
      spools: [
        { id: 'f-1', brand: 'Marca 1', material: 'PLA', colorName: 'Rojo', availableGrams: 500 },
      ],
      truncated: false,
    });
  });

  it('follows the pages until the total is covered', async () => {
    const result = firstValueFrom(api.loadAll());

    http.expectOne((r) => r.url === URL).flush(pageBody(1, 100, 130));
    http
      .expectOne((r) => r.url === URL && r.params.get('page') === '2')
      .flush(pageBody(101, 30, 130));

    expect((await result).spools).toHaveLength(130);
  });

  it('stops at 10 pages and says the catalogue was cut', async () => {
    const result = firstValueFrom(api.loadAll());

    for (let page = 1; page <= 10; page += 1) {
      http
        .expectOne((r) => r.url === URL && r.params.get('page') === String(page))
        .flush(pageBody((page - 1) * 100 + 1, 100, 1500));
    }

    await expect(result).resolves.toMatchObject({ truncated: true });
    http.expectNone((r) => r.url === URL && r.params.get('page') === '11');
  });

  it('answers an empty catalogue when there are no spools', async () => {
    const result = firstValueFrom(api.loadAll());

    http.expectOne((r) => r.url === URL).flush(pageBody(1, 0, 0));

    await expect(result).resolves.toEqual({ spools: [], truncated: false });
  });

  it.each([
    ['an unknown material', { ...spool(1), material: 'GOLD' }],
    ['fractional grams', { ...spool(1), availableGrams: 1.5 }],
    ['a missing colour', { ...spool(1), colorName: undefined }],
  ])('rejects a spool with %s', async (_name, item) => {
    const result = firstValueFrom(api.loadAll());

    http.expectOne((r) => r.url === URL).flush({ items: [item], page: 1, pageSize: 100, total: 1 });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('maps a failed request to an ApiError', async () => {
    const result = firstValueFrom(api.loadAll());

    http.expectOne((r) => r.url === URL).error(new ProgressEvent('error'));

    await expect(result).rejects.toMatchObject({ code: 'network_error' });
  });
});
