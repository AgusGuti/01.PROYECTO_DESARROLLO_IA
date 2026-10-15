import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { PartsPickerApi } from './parts-picker-api';

const URL = 'http://api.test/api/v1/parts';

/** A part with extra fields the picker must ignore. */
function part(index: number) {
  return {
    id: `id-${String(index)}`,
    name: `Pieza ${String(index)}`,
    material: 'PLA',
    estimatedWeightGrams: 25,
  };
}

function pageBody(first: number, count: number, total: number) {
  return {
    items: Array.from({ length: count }, (_, offset) => part(first + offset)),
    page: 1,
    pageSize: 100,
    total,
  };
}

describe('PartsPickerApi', () => {
  let api: PartsPickerApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(PartsPickerApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('asks for 100 parts sorted by name and keeps only id, name and material', async () => {
    const result = firstValueFrom(api.loadAll());

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('100');
    expect(request.request.params.get('sort')).toBe('name');
    expect(request.request.params.get('order')).toBe('asc');
    request.flush(pageBody(1, 1, 1));

    await expect(result).resolves.toEqual({
      parts: [{ id: 'id-1', name: 'Pieza 1', material: 'PLA' }],
      truncated: false,
    });
  });

  it('follows the pages until the total is covered', async () => {
    const result = firstValueFrom(api.loadAll());

    http.expectOne((r) => r.url === URL).flush(pageBody(1, 100, 230));
    const second = http.expectOne((r) => r.url === URL && r.params.get('page') === '2');
    second.flush(pageBody(101, 100, 230));
    const third = http.expectOne((r) => r.url === URL && r.params.get('page') === '3');
    third.flush(pageBody(201, 30, 230));

    const catalogue = await result;
    expect(catalogue.parts).toHaveLength(230);
    expect(catalogue.parts[229]?.id).toBe('id-230');
    expect(catalogue.truncated).toBe(false);
  });

  it('stops at 10 pages and says the catalogue was cut', async () => {
    const result = firstValueFrom(api.loadAll());

    for (let page = 1; page <= 10; page += 1) {
      http
        .expectOne((r) => r.url === URL && r.params.get('page') === String(page))
        .flush(pageBody((page - 1) * 100 + 1, 100, 1500));
    }

    const catalogue = await result;
    expect(catalogue.parts).toHaveLength(1000);
    expect(catalogue.truncated).toBe(true);
    http.expectNone((r) => r.url === URL && r.params.get('page') === '11');
  });

  it('does not report a cut when the catalogue fits exactly in 10 pages', async () => {
    const result = firstValueFrom(api.loadAll());

    for (let page = 1; page <= 10; page += 1) {
      http
        .expectOne((r) => r.url === URL && r.params.get('page') === String(page))
        .flush(pageBody((page - 1) * 100 + 1, 100, 1000));
    }

    await expect(result).resolves.toMatchObject({ truncated: false });
  });

  it('never loops when the server claims a different page than the one asked for', async () => {
    const result = firstValueFrom(api.loadAll());

    for (let page = 1; page <= 10; page += 1) {
      http
        .expectOne((r) => r.url === URL && r.params.get('page') === String(page))
        .flush({ ...pageBody(1, 100, 99_999), page: 1 });
    }

    await expect(result).resolves.toMatchObject({ truncated: true });
  });

  it('rejects a response whose parts do not match the minimal shape', async () => {
    const result = firstValueFrom(api.loadAll());

    http
      .expectOne((r) => r.url === URL)
      .flush({
        items: [{ id: 'a', name: 'x', material: 'GOLD' }],
        page: 1,
        pageSize: 100,
        total: 1,
      });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('maps a failed request to an ApiError', async () => {
    const result = firstValueFrom(api.loadAll());

    http.expectOne((r) => r.url === URL).error(new ProgressEvent('error'));

    await expect(result).rejects.toMatchObject({ code: 'network_error' });
  });
});
