import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CreateQueueRequest } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { QueuesApi } from './queues-api';

const BASE = 'http://api.test/api/v1';

const QUEUE = {
  projectId: 'p1',
  goal: 'deadline',
  mode: 'single',
  printerIds: ['pr1'],
  lines: [
    {
      partId: 'a',
      quantity: 3,
      completed: 1,
      pendingUnits: 2,
      partName: 'Soporte',
      estimatedPrintSeconds: 600,
      partDeleted: false,
    },
  ],
  totals: { totalUnits: 3, completedUnits: 1, pendingUnits: 2, pendingSeconds: 1200 },
  version: 4,
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:00.000Z',
};

describe('QueuesApi', () => {
  let api: QueuesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(QueuesApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('gets the queue of a project', async () => {
    const result = firstValueFrom(api.get('p/1'));

    http.expectOne({ method: 'GET', url: `${BASE}/queues/p%2F1` }).flush(QUEUE);

    await expect(result).resolves.toEqual(QUEUE);
  });

  it('answers null when the project has no queue yet (404 is not an error)', async () => {
    const result = firstValueFrom(api.get('p1'));

    http
      .expectOne(`${BASE}/queues/p1`)
      .flush({ code: 'not_found' }, { status: 404, statusText: 'x' });

    await expect(result).resolves.toBeNull();
  });

  it('still fails on a 503', async () => {
    const result = firstValueFrom(api.get('p1'));

    http.expectOne(`${BASE}/queues/p1`).flush({ detail: 'boom' }, { status: 503, statusText: 'x' });

    await expect(result).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    ['not an object', 'nope'],
    ['an unknown goal', { ...QUEUE, goal: 'whenever' }],
    ['a fractional version', { ...QUEUE, version: 1.5 }],
    ['a line without a flag', { ...QUEUE, lines: [{ ...QUEUE.lines[0], partDeleted: 'no' }] }],
    ['missing totals', { ...QUEUE, totals: null }],
  ])('rejects %s as an unexpected response', async (_name, body) => {
    const result = firstValueFrom(api.get('p1'));

    http.expectOne(`${BASE}/queues/p1`).flush(body);

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('posts a new queue and returns it', async () => {
    const body: CreateQueueRequest = {
      projectId: 'p1',
      goal: 'fastest',
      mode: 'single',
      printerIds: ['pr1'],
    };
    const result = firstValueFrom(api.create(body));

    const request = http.expectOne({ method: 'POST', url: `${BASE}/queues` });
    expect(request.request.body).toEqual(body);
    request.flush(QUEUE, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(QUEUE);
  });

  it('patches with the version', async () => {
    const result = firstValueFrom(api.update('p1', { version: 4, goal: 'fastest' }));

    const request = http.expectOne({ method: 'PATCH', url: `${BASE}/queues/p1` });
    expect(request.request.body).toEqual({ version: 4, goal: 'fastest' });
    request.flush(QUEUE);

    await expect(result).resolves.toEqual(QUEUE);
  });

  it('deletes sending the version as a query parameter', async () => {
    const result = firstValueFrom(api.remove('p1', 4), { defaultValue: undefined });

    http.expectOne({ method: 'DELETE', url: `${BASE}/queues/p1?version=4` }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('lists live printers and drops archived ones', async () => {
    const result = firstValueFrom(api.printers());

    const request = http.expectOne((r) => r.url === `${BASE}/printers`);
    expect(request.request.params.get('pageSize')).toBe('100');
    request.flush({
      items: [
        { id: 'a', name: 'Ender', archivedAt: null },
        { id: 'b', name: 'Vieja', archivedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });

    await expect(result).resolves.toEqual([{ id: 'a', name: 'Ender' }]);
  });

  it('rejects a malformed printer list', async () => {
    const result = firstValueFrom(api.printers());

    http.expectOne((r) => r.url === `${BASE}/printers`).flush({ items: [{ id: 1 }] });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('reads the project lines, with null for a deleted part', async () => {
    const result = firstValueFrom(api.project('p1'));

    http.expectOne(`${BASE}/projects/p1`).flush({
      name: 'Taller',
      items: [
        { partId: 'a', quantity: 3, part: { name: 'Soporte' } },
        { partId: 'b', quantity: 1, part: null },
      ],
    });

    await expect(result).resolves.toEqual({
      name: 'Taller',
      lines: [
        { partId: 'a', name: 'Soporte', quantity: 3 },
        { partId: 'b', name: null, quantity: 1 },
      ],
    });
  });

  it('rejects a malformed project', async () => {
    const result = firstValueFrom(api.project('p1'));

    http.expectOne(`${BASE}/projects/p1`).flush({ name: 'x', items: [{ partId: 3 }] });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });
});
