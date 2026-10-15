import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Project, ProjectList, ProjectSummary } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { isProject, isProjectList, ProjectsApi } from './projects-api';

const project: Project = {
  id: '66f0c0ffee0123456789abcd',
  name: 'Soportes para el taller',
  description: null,
  priority: 'normal',
  deadline: '2026-11-30',
  items: [
    { partId: 'a1', quantity: 2, part: { name: 'Soporte', material: 'PLA' } },
    { partId: 'b2', quantity: 1, part: null },
  ],
  version: 1,
  createdAt: '2026-10-15T12:00:00.000Z',
  updatedAt: '2026-10-15T12:00:00.000Z',
};
const summary: ProjectSummary = {
  id: project.id,
  name: project.name,
  description: null,
  priority: 'normal',
  deadline: null,
  itemCount: 2,
  unitCount: 3,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const list: ProjectList = { items: [summary], page: 1, pageSize: 20, total: 1 };
const URL = 'http://api.test/api/v1/projects';

describe('ProjectsApi', () => {
  let api: ProjectsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(ProjectsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lists projects sending the priority, sort, order and paging it was given', async () => {
    const result = firstValueFrom(
      api.list({ page: 2, pageSize: 20, priority: 'urgent', sort: 'deadline', order: 'asc' }),
    );

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('20');
    expect(request.request.params.get('priority')).toBe('urgent');
    expect(request.request.params.get('sort')).toBe('deadline');
    expect(request.request.params.get('order')).toBe('asc');
    request.flush({ ...list, page: 2 });

    await expect(result).resolves.toMatchObject({ page: 2, total: 1 });
  });

  it('sends no priority, sort or order parameter when none was asked for', async () => {
    const result = firstValueFrom(api.list({ page: 1, pageSize: 20 }));

    const request = http.expectOne((r) => r.url === URL);
    expect(request.request.params.keys().sort()).toEqual(['page', 'pageSize']);
    request.flush(list);

    await expect(result).resolves.toEqual(list);
  });

  it('gets one project by id and encodes the id so it cannot change the path', async () => {
    const result = firstValueFrom(api.get('a/b?c'));

    http.expectOne({ method: 'GET', url: `${URL}/a%2Fb%3Fc` }).flush(project);

    await expect(result).resolves.toEqual(project);
  });

  it('creates a project with a POST and the given body', async () => {
    const body = { name: 'Soportes', items: [{ partId: 'a1', quantity: 2 }] };
    const result = firstValueFrom(api.create(body));

    const request = http.expectOne({ method: 'POST', url: URL });
    expect(request.request.body).toEqual(body);
    request.flush(project, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(project);
  });

  it('does not retry a POST on its own after a failure', async () => {
    const result = firstValueFrom(api.create({ name: 'x' }));

    http.expectOne({ method: 'POST', url: URL }).flush(null, {
      status: 503,
      statusText: 'Unavailable',
    });

    await expect(result).rejects.toBeInstanceOf(ApiError);
    http.expectNone(URL);
  });

  it('updates a project with a PATCH that carries the version and a null to clear', async () => {
    const result = firstValueFrom(
      api.update(project.id, { version: 3, description: null, deadline: null }),
    );

    const request = http.expectOne({ method: 'PATCH', url: `${URL}/${project.id}` });
    expect(request.request.body).toEqual({ version: 3, description: null, deadline: null });
    request.flush({ ...project, version: 4 });

    await expect(result).resolves.toMatchObject({ version: 4 });
  });

  it('removes a project with a DELETE and completes on 204', async () => {
    const result = firstValueFrom(api.remove(project.id));

    http
      .expectOne({ method: 'DELETE', url: `${URL}/${project.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  it('rejects a list response that does not match the contract', async () => {
    const result = firstValueFrom(api.list());

    http
      .expectOne((r) => r.url === URL)
      .flush({ items: [{ ...summary, priority: 'critical' }], page: 1, pageSize: 20, total: 1 });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('rejects a project response that is not a project', async () => {
    const result = firstValueFrom(api.get(project.id));

    http.expectOne(`${URL}/${project.id}`).flush({ ok: true });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('maps a version conflict to an ApiError that keeps the problem issues', async () => {
    const result = firstValueFrom(api.update(project.id, { version: 1, name: 'x' }));

    http.expectOne(`${URL}/${project.id}`).flush(
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
      issues: [{ path: 'version', message: 'Does not match the current version.' }],
    });
  });

  it('fails with a network ApiError when the server cannot be reached', async () => {
    const result = firstValueFrom(api.list());

    http.expectOne((r) => r.url === URL).error(new ProgressEvent('error'));

    await expect(result).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('isProject', () => {
  it('accepts a project with a live line and a deleted-part line', () => {
    expect(isProject(project)).toBe(true);
    expect(isProject({ ...project, description: 'Una línea', items: [] })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a priority outside the catalog', { ...project, priority: 'critical' }],
    ['a deadline sent as a number', { ...project, deadline: 20261130 }],
    ['an undefined description', { ...project, description: undefined }],
    [
      'a line with a fractional quantity',
      { ...project, items: [{ partId: 'a', quantity: 1.5, part: null }] },
    ],
    [
      'a line whose part has an unknown material',
      { ...project, items: [{ partId: 'a', quantity: 1, part: { name: 'x', material: 'GOLD' } }] },
    ],
    ['a line without part', { ...project, items: [{ partId: 'a', quantity: 1 }] }],
    ['items that are not an array', { ...project, items: 'none' }],
    ['a missing version', { ...project, version: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(isProject(value)).toBe(false);
  });
});

describe('isProjectList', () => {
  it('accepts a page of summaries', () => {
    expect(isProjectList(list)).toBe(true);
  });

  it('rejects a page with one malformed item or without paging numbers', () => {
    expect(isProjectList({ ...list, items: [{ ...summary, unitCount: '3' }] })).toBe(false);
    expect(isProjectList({ items: [] })).toBe(false);
    expect(isProjectList('nope')).toBe(false);
  });
});
