import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Part, PartList } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { isPart, isPartList, isPartUsage, PartsApi } from './parts-api';

const part: Part = {
  id: '66f0c0ffee0123456789abcd',
  name: 'Soporte de cable',
  description: null,
  material: 'PLA',
  dimensionsMm: { x: 40, y: 30, z: 20 },
  estimatedWeightGrams: 25,
  estimatedPrintSeconds: 7380,
  layerHeightUm: 200,
  suggestedPrinterName: null,
  source: { kind: 'manual' },
  version: 1,
  createdAt: '2026-10-15T12:00:00.000Z',
  updatedAt: '2026-10-15T12:00:00.000Z',
};
const list: PartList = { items: [part], page: 1, pageSize: 20, total: 1 };
const URL = 'http://api.test/api/v1/parts';

describe('PartsApi', () => {
  let api: PartsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(PartsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lists parts sending only the query parameters it was given', async () => {
    const result = firstValueFrom(
      api.list({
        page: 2,
        pageSize: 20,
        material: 'PETG',
        sort: 'estimatedWeightGrams',
        order: 'desc',
      }),
    );

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('20');
    expect(request.request.params.get('material')).toBe('PETG');
    expect(request.request.params.get('sort')).toBe('estimatedWeightGrams');
    expect(request.request.params.get('order')).toBe('desc');
    request.flush({ ...list, page: 2 });

    await expect(result).resolves.toMatchObject({ page: 2, total: 1 });
  });

  it('sends no material, sort or order parameter when none was asked for', async () => {
    const result = firstValueFrom(api.list({ page: 1, pageSize: 20 }));

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.params.keys().sort()).toEqual(['page', 'pageSize']);
    request.flush(list);

    await expect(result).resolves.toEqual(list);
  });

  it('gets one part by id', async () => {
    const result = firstValueFrom(api.get(part.id));

    http.expectOne({ method: 'GET', url: `${URL}/${part.id}` }).flush(part);

    await expect(result).resolves.toEqual(part);
  });

  it('encodes the id so it can never change the path', async () => {
    const result = firstValueFrom(api.get('a/b?c'));

    http.expectOne({ method: 'GET', url: `${URL}/a%2Fb%3Fc` }).flush(part);

    await expect(result).resolves.toEqual(part);
  });

  it('creates a part with a POST and the given body', async () => {
    const body = {
      name: 'Soporte de cable',
      material: 'PLA',
      dimensionsMm: { x: 40, y: 30, z: 20 },
      estimatedWeightGrams: 25,
      estimatedPrintSeconds: 7380,
      layerHeightUm: 200,
    } as const;
    const result = firstValueFrom(api.create(body));

    const request = http.expectOne({ method: 'POST', url: URL });
    expect(request.request.body).toEqual(body);
    request.flush(part, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(part);
  });

  it('does not retry a POST on its own after a failure', async () => {
    const result = firstValueFrom(
      api.create({
        name: 'x',
        material: 'PLA',
        dimensionsMm: { x: 1, y: 1, z: 1 },
        estimatedWeightGrams: 1,
        estimatedPrintSeconds: 1,
        layerHeightUm: 200,
      }),
    );

    http.expectOne({ method: 'POST', url: URL }).flush(null, {
      status: 503,
      statusText: 'Unavailable',
    });

    await expect(result).rejects.toBeInstanceOf(ApiError);
    http.expectNone(URL);
  });

  it('updates a part with a PATCH that carries the version and a null to clear', async () => {
    const result = firstValueFrom(api.update(part.id, { version: 3, description: null }));

    const request = http.expectOne({ method: 'PATCH', url: `${URL}/${part.id}` });
    expect(request.request.body).toEqual({ version: 3, description: null });
    request.flush({ ...part, version: 4 });

    await expect(result).resolves.toMatchObject({ version: 4 });
  });

  it('removes a part with a DELETE and completes on 204', async () => {
    const result = firstValueFrom(api.remove(part.id));

    http
      .expectOne({ method: 'DELETE', url: `${URL}/${part.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  it('sends no query parameter on a plain DELETE or when the flag is false', async () => {
    const plain = firstValueFrom(api.remove(part.id));
    const plainRequest = http.expectOne({ method: 'DELETE', url: `${URL}/${part.id}` });
    expect(plainRequest.request.params.keys()).toEqual([]);
    plainRequest.flush(null, { status: 204, statusText: 'No Content' });
    await plain;

    const explicit = firstValueFrom(api.remove(part.id, { removeFromProjects: false }));
    const explicitRequest = http.expectOne({ method: 'DELETE', url: `${URL}/${part.id}` });
    expect(explicitRequest.request.params.keys()).toEqual([]);
    explicitRequest.flush(null, { status: 204, statusText: 'No Content' });
    await explicit;
  });

  it('sends removeFromProjects=true only when the removal was confirmed', async () => {
    const result = firstValueFrom(api.remove(part.id, { removeFromProjects: true }));

    const request = http.expectOne((r) => r.url === `${URL}/${part.id}`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.params.get('removeFromProjects')).toBe('true');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  it('maps the in-use conflict to an ApiError that keeps the projects issue', async () => {
    const result = firstValueFrom(api.remove(part.id));

    http
      .expectOne(`${URL}/${part.id}`)
      .flush(
        { code: 'conflict', detail: 'backend text', issues: [{ path: 'projects', message: 'x' }] },
        { status: 409, statusText: 'Conflict' },
      );

    await expect(result).rejects.toMatchObject({
      status: 409,
      issues: [{ path: 'projects', message: 'x' }],
    });
  });

  it('gets the usage of a part from its usage endpoint', async () => {
    const usage = { total: 2, projects: [{ id: 'p1', name: 'Taller', quantity: 3 }] };
    const result = firstValueFrom(api.usage(part.id));

    http.expectOne({ method: 'GET', url: `${URL}/${part.id}/usage` }).flush(usage);

    await expect(result).resolves.toEqual(usage);
  });

  it('rejects a usage response that does not match the contract', async () => {
    const result = firstValueFrom(api.usage(part.id));

    http
      .expectOne(`${URL}/${part.id}/usage`)
      .flush({ total: 1, projects: [{ id: 'p1', name: 'Taller', quantity: '3' }] });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('rejects a list response that does not match the contract', async () => {
    const result = firstValueFrom(api.list());

    http
      .expectOne((r) => r.url === URL)
      .flush({ items: [{ ...part, material: 'GOLD' }], page: 1, pageSize: 20, total: 1 });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('rejects a part response that is not a part', async () => {
    const result = firstValueFrom(api.get(part.id));

    http.expectOne(`${URL}/${part.id}`).flush({ ok: true });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('maps a version conflict to an ApiError that keeps the problem issues', async () => {
    const result = firstValueFrom(api.update(part.id, { version: 1, name: 'x' }));

    http.expectOne(`${URL}/${part.id}`).flush(
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

describe('isPart', () => {
  it('accepts a manual part and a part imported from G-code', () => {
    expect(isPart(part)).toBe(true);
    expect(
      isPart({
        ...part,
        description: 'Una línea',
        suggestedPrinterName: 'Ender 3',
        source: {
          kind: 'gcode',
          fileName: 'a.gcode',
          slicer: 'cura',
          analyzedAt: '2026-10-15T12:00:00.000Z',
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['a material outside the catalog', { ...part, material: 'GOLD' }],
    ['fractional weight', { ...part, estimatedWeightGrams: 2.5 }],
    ['weight sent as text', { ...part, estimatedWeightGrams: '25' }],
    ['a missing dimension', { ...part, dimensionsMm: { x: 1, y: 2 } }],
    ['a fractional dimension', { ...part, dimensionsMm: { x: 1.5, y: 2, z: 3 } }],
    ['an undefined description', { ...part, description: undefined }],
    ['an unknown source kind', { ...part, source: { kind: 'cloud' } }],
    ['a gcode source without analyzedAt', { ...part, source: { kind: 'gcode', fileName: 'a' } }],
    [
      'a gcode source from another slicer',
      {
        ...part,
        source: { kind: 'gcode', fileName: 'a', slicer: 'prusa', analyzedAt: 'x' },
      },
    ],
    ['a missing version', { ...part, version: undefined }],
    ['a missing name', { ...part, name: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(isPart(value)).toBe(false);
  });
});

describe('isPartUsage', () => {
  it('accepts a total with a list of projects, possibly empty', () => {
    expect(isPartUsage({ total: 0, projects: [] })).toBe(true);
    expect(isPartUsage({ total: 51, projects: [{ id: 'a', name: 'b', quantity: 1 }] })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a total sent as text', { total: '1', projects: [] }],
    ['projects that are not an array', { total: 1, projects: 'x' }],
    ['a project without a name', { total: 1, projects: [{ id: 'a', quantity: 1 }] }],
    ['a fractional quantity', { total: 1, projects: [{ id: 'a', name: 'b', quantity: 1.5 }] }],
  ])('rejects %s', (_name, value) => {
    expect(isPartUsage(value)).toBe(false);
  });
});

describe('isPartList', () => {
  it('accepts a page of parts', () => {
    expect(isPartList(list)).toBe(true);
  });

  it('rejects a page with one malformed item or without paging numbers', () => {
    expect(isPartList({ ...list, items: [{ ...part, id: 5 }] })).toBe(false);
    expect(isPartList({ items: [] })).toBe(false);
    expect(isPartList('nope')).toBe(false);
  });
});
