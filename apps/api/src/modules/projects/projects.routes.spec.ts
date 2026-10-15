// API tests: the real Express app over HTTP, with in-memory fakes instead of MongoDB.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { projectListSchema, projectSchema } from './projects.schemas.js';
import {
  createFakePartLookup,
  createFakeProjectRepository,
  createTestClock,
  PART_A,
  PART_B,
} from './testing/fakes.js';

const BASE = '/api/v1/projects';
const MISSING_ID = '0'.repeat(24);

const DTO_KEYS = [
  'createdAt',
  'deadline',
  'description',
  'id',
  'items',
  'name',
  'priority',
  'updatedAt',
  'version',
];
const SUMMARY_KEYS = [
  'createdAt',
  'deadline',
  'description',
  'id',
  'itemCount',
  'name',
  'priority',
  'unitCount',
  'updatedAt',
];

function setup() {
  const repository = createFakeProjectRepository();
  const parts = createFakePartLookup();
  const clock = createTestClock();
  const app = createTestApp({
    clock,
    env: { RATE_LIMIT_MAX: '100000' },
    projects: { repository, partLookup: parts.lookup },
  });
  return { app, repository, parts, clock };
}

function expectProblem(
  response: request.Response,
  status: number,
  code: string,
): ReturnType<typeof problemSchema.parse> {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = problemSchema.parse(response.body);
  expect(problem).toMatchObject({ status, code });
  return problem;
}

const namesOf = (response: request.Response): string[] =>
  (response.body as { items: { name: string }[] }).items.map((item) => item.name);

describe('POST /api/v1/projects', () => {
  it('creates a project: 201, Location and the full DTO with defaults', async () => {
    const { app, clock } = setup();

    const response = await request(app).post(BASE).send({ name: 'Soportes para el taller' });

    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    expect(response.headers['location']).toBe(`${BASE}/${id}`);
    expect(response.body).toEqual({
      id,
      name: 'Soportes para el taller',
      description: null,
      priority: 'normal',
      deadline: null,
      items: [],
      version: 1,
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    });
    projectSchema.parse(response.body);
  });

  it('returns the lines with the current name and material of each part', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({
        name: 'Con piezas',
        priority: 'urgent',
        deadline: '2026-12-24',
        description: ' Para regalo ',
        items: [
          { partId: PART_A, quantity: 6 },
          { partId: PART_B, quantity: 1 },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      description: 'Para regalo',
      priority: 'urgent',
      deadline: '2026-12-24',
      items: [
        {
          partId: PART_A,
          quantity: 6,
          part: { name: 'Soporte de estante en L', material: 'PETG' },
        },
        { partId: PART_B, quantity: 1, part: { name: 'Florero espiral', material: 'PLA' } },
      ],
    });
  });

  it('accepts a past deadline and two projects with the same name', async () => {
    const { app, repository } = setup();

    const first = await request(app).post(BASE).send({ name: 'Igual', deadline: '2001-01-01' });
    const second = await request(app).post(BASE).send({ name: 'Igual' });

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(repository.stored.size).toBe(2);
  });

  it.each(['id', '_id', 'version', 'deletedAt', 'createdAt', 'updatedAt', 'status', '$set'])(
    'rejects the key %s without calling the repository or the lookup',
    async (key) => {
      const { app, repository, parts } = setup();

      const response = await request(app)
        .post(BASE)
        .send({ name: 'x', [key]: 1 });

      expectProblem(response, 400, 'validation_failed');
      expect(repository.calls).toEqual([]);
      expect(parts.calls).toEqual([]);
    },
  );

  it('rejects an own __proto__ key sent as raw JSON', async () => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(BASE)
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"admin":true},"name":"x"}');

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('rejects invalid input with per-field issues and does not echo the body', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ name: 'SECRET-NAME\n', priority: 'asap', deadline: '2026-02-30' });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['name', 'priority', 'deadline']),
    );
    expect(JSON.stringify(response.body)).not.toContain('SECRET-NAME');
    expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules|\.ts:/);
  });

  it('reports a repeated part on the second occurrence and stores nothing', async () => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(BASE)
      .send({
        name: 'x',
        items: [
          { partId: PART_A, quantity: 1 },
          { partId: PART_B, quantity: 1 },
          { partId: PART_A, quantity: 1 },
        ],
      });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([{ path: 'items.2.partId', message: 'Duplicated part.' }]);
    expect(repository.stored.size).toBe(0);
  });

  it('reports a part that does not exist or was deleted with the same text', async () => {
    const { app, parts, repository } = setup();
    parts.live.delete(PART_B);

    const response = await request(app)
      .post(BASE)
      .send({
        name: 'x',
        items: [
          { partId: PART_A, quantity: 1 },
          { partId: PART_B, quantity: 1 },
          { partId: 'c'.repeat(24), quantity: 1 },
        ],
      });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([
      { path: 'items.1.partId', message: 'The part does not exist.' },
      { path: 'items.2.partId', message: 'The part does not exist.' },
    ]);
    expect(repository.stored.size).toBe(0);
  });

  it('answers 400 for a request without a JSON body', async () => {
    const { app } = setup();

    expectProblem(await request(app).post(BASE), 400, 'validation_failed');
  });
});

describe('GET /api/v1/projects/:id', () => {
  it('returns the detail and asks the lookup once for all the lines', async () => {
    const { app, repository, parts } = setup();
    const project = repository.seed({
      items: [
        { partId: PART_A, quantity: 2 },
        { partId: PART_B, quantity: 3 },
      ],
    });

    const response = await request(app).get(`${BASE}/${project.id}`);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object).sort()).toEqual(DTO_KEYS);
    expect(parts.calls).toHaveLength(1);
    expect(response.body).toMatchObject({
      items: [
        { partId: PART_A, quantity: 2, part: { name: 'Soporte de estante en L' } },
        { partId: PART_B, quantity: 3, part: { name: 'Florero espiral' } },
      ],
    });
  });

  it('shows part null for a line whose part was deleted, with exactly the line keys', async () => {
    const { app, repository, parts } = setup();
    parts.live.delete(PART_A);
    const project = repository.seed({ items: [{ partId: PART_A, quantity: 2 }] });

    const response = await request(app).get(`${BASE}/${project.id}`);

    expect(response.status).toBe(200);
    expect((response.body as { items: unknown[] }).items).toEqual([
      { partId: PART_A, quantity: 2, part: null },
    ]);
  });

  it('never leaks deletedAt or any internal field', async () => {
    const { app, repository } = setup();
    const project = repository.seed();

    const response = await request(app).get(`${BASE}/${project.id}`);

    expect(response.body).toEqual({
      id: project.id,
      name: 'Soportes para el taller',
      description: null,
      priority: 'normal',
      deadline: null,
      items: [],
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('answers 404 for a missing or deleted project and 400 for a malformed id', async () => {
    const { app, repository } = setup();
    const gone = repository.seed({ deletedAt: new Date() });

    expectProblem(await request(app).get(`${BASE}/${MISSING_ID}`), 404, 'not_found');
    expectProblem(await request(app).get(`${BASE}/${gone.id}`), 404, 'not_found');
    expectProblem(await request(app).get(`${BASE}/not-an-id`), 400, 'validation_failed');
  });

  it('answers 503 when the part data is unavailable', async () => {
    const { app, repository, parts } = setup();
    const project = repository.seed({ items: [{ partId: PART_A, quantity: 1 }] });
    parts.failWith = new AppError(
      'service_unavailable',
      'The part data is temporarily unavailable.',
    );

    expectProblem(await request(app).get(`${BASE}/${project.id}`), 503, 'service_unavailable');
  });
});

describe('GET /api/v1/projects', () => {
  const seedMany = (repository: ReturnType<typeof setup>['repository']) => {
    repository.seed({
      name: 'Beta',
      priority: 'high',
      deadline: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      items: [
        { partId: PART_A, quantity: 6 },
        { partId: PART_B, quantity: 2 },
      ],
    });
    repository.seed({
      name: 'alfa',
      priority: 'low',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    repository.seed({
      name: 'Gamma',
      priority: 'urgent',
      deadline: new Date('2026-11-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    repository.seed({ name: 'Borrado', deletedAt: new Date() });
  };

  it('returns summaries with exactly the summary keys and no lookup', async () => {
    const { app, repository, parts } = setup();
    seedMany(repository);

    const response = await request(app).get(BASE).query({ sort: 'name', order: 'asc' });

    expect(response.status).toBe(200);
    const body = response.body as { items: Record<string, unknown>[]; total: number };
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
    expect(body.items[1]).toMatchObject({
      name: 'Beta',
      deadline: '2026-12-01',
      itemCount: 2,
      unitCount: 8,
    });
    expect(body.total).toBe(3);
    expect(parts.calls).toEqual([]);
    projectListSchema.parse(response.body);
  });

  it('sorts newest first by default and never lists a deleted project', async () => {
    const { app, repository } = setup();
    seedMany(repository);

    expect(namesOf(await request(app).get(BASE))).toEqual(['alfa', 'Beta', 'Gamma']);
  });

  it('sorts by priority from low to urgent and back', async () => {
    const { app, repository } = setup();
    seedMany(repository);

    const asc = await request(app).get(BASE).query({ sort: 'priority', order: 'asc' });
    const desc = await request(app).get(BASE).query({ sort: 'priority', order: 'desc' });

    expect(namesOf(asc)).toEqual(['alfa', 'Beta', 'Gamma']);
    expect(namesOf(desc)).toEqual(['Gamma', 'Beta', 'alfa']);
  });

  it('puts a project without a deadline last in both directions', async () => {
    const { app, repository } = setup();
    seedMany(repository);

    const asc = await request(app).get(BASE).query({ sort: 'deadline', order: 'asc' });
    const desc = await request(app).get(BASE).query({ sort: 'deadline', order: 'desc' });

    expect(namesOf(asc)).toEqual(['Gamma', 'Beta', 'alfa']);
    expect(namesOf(desc)).toEqual(['Beta', 'Gamma', 'alfa']);
  });

  it('filters by priority and counts only the matching projects', async () => {
    const { app, repository } = setup();
    seedMany(repository);

    const response = await request(app).get(BASE).query({ priority: 'high' });

    expect(namesOf(response)).toEqual(['Beta']);
    expect(response.body).toMatchObject({ total: 1 });
  });

  it('paginates: second page, a page past the end and the biggest page size', async () => {
    const { app, repository } = setup();
    for (let i = 0; i < 25; i += 1) repository.seed({ name: `P${String(i).padStart(2, '0')}` });

    const second = await request(app)
      .get(BASE)
      .query({ page: 2, pageSize: 10, sort: 'name', order: 'asc' });
    const beyond = await request(app).get(BASE).query({ page: 10000 });
    const biggest = await request(app).get(BASE).query({ pageSize: 100 });

    expect(namesOf(second)).toEqual(
      Array.from({ length: 10 }, (_v, i) => `P${String(i + 10).padStart(2, '0')}`),
    );
    expect(second.body).toMatchObject({ page: 2, pageSize: 10, total: 25 });
    expect(beyond.body).toMatchObject({ items: [], total: 25 });
    expect(namesOf(biggest)).toHaveLength(25);
  });

  it.each([
    ['page 0', { page: '0' }],
    ['pageSize 101', { pageSize: '101' }],
    ['an unknown priority', { priority: 'critical' }],
    ['an unknown sort', { sort: 'deletedAt' }],
    ['an unknown key', { deletedAt: 'x' }],
  ])('rejects %s without calling the repository', async (_label, query) => {
    const { app, repository } = setup();

    expectProblem(await request(app).get(BASE).query(query), 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });
});

describe('PATCH /api/v1/projects/:id', () => {
  it('edits the fields, keeps the lines and bumps the version', async () => {
    const { app, repository, clock } = setup();
    const project = repository.seed({ items: [{ partId: PART_A, quantity: 4 }] });
    clock.advanceSeconds(60);

    const response = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({ version: 1, name: 'Nuevo', priority: 'high', deadline: '2027-01-31' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Nuevo',
      priority: 'high',
      deadline: '2027-01-31',
      version: 2,
      updatedAt: clock.now().toISOString(),
      items: [{ partId: PART_A, quantity: 4, part: { name: 'Soporte de estante en L' } }],
    });
    expect(Object.keys(response.body as object).sort()).toEqual(DTO_KEYS);
  });

  it('replaces the lines, empties them with [] and clears the optionals with null', async () => {
    const { app, repository } = setup();
    const project = repository.seed({
      description: 'x',
      deadline: new Date('2026-12-01T00:00:00.000Z'),
      items: [{ partId: PART_A, quantity: 4 }],
    });

    const replaced = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({ version: 1, items: [{ partId: PART_B, quantity: 9 }] });
    const emptied = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({ version: 2, items: [], description: null, deadline: null });

    expect(replaced.body).toMatchObject({ items: [{ partId: PART_B, quantity: 9 }], version: 2 });
    expect(emptied.body).toMatchObject({
      items: [],
      description: null,
      deadline: null,
      version: 3,
    });
  });

  it('rejects a body with only the version and an unknown key before reading anything', async () => {
    const { app, repository } = setup();
    const project = repository.seed();
    repository.calls.length = 0;

    expectProblem(
      await request(app).patch(`${BASE}/${project.id}`).send({ version: 1 }),
      400,
      'validation_failed',
    );
    expectProblem(
      await request(app).patch(`${BASE}/${project.id}`).send({ version: 1, status: 'x' }),
      400,
      'validation_failed',
    );
    expect(repository.calls).toEqual([]);
  });

  it('answers 404 for a missing project and 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(
      await request(app).patch(`${BASE}/${MISSING_ID}`).send({ version: 1, name: 'x' }),
      404,
      'not_found',
    );
    expectProblem(
      await request(app).patch(`${BASE}/nope`).send({ version: 1, name: 'x' }),
      400,
      'validation_failed',
    );
  });

  it('answers 409 with an issue on version for a stale edit, even with a bad part', async () => {
    const { app, repository, parts } = setup();
    const project = repository.seed({ version: 4 });
    parts.live.clear();

    const response = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({ version: 3, items: [{ partId: PART_A, quantity: 1 }] });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([
      { path: 'version', message: 'Does not match the current version.' },
    ]);
    expect(repository.stored.get(project.id)?.version).toBe(4);
  });

  it('answers 400 for duplicates and for a part that does not exist, leaving the project as it was', async () => {
    const { app, repository, parts } = setup();
    const project = repository.seed();

    const duplicated = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({
        version: 1,
        items: [
          { partId: PART_A, quantity: 1 },
          { partId: PART_A, quantity: 1 },
        ],
      });
    parts.live.clear();
    const missing = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({ version: 1, items: [{ partId: PART_A, quantity: 1 }] });

    expect(expectProblem(duplicated, 400, 'validation_failed').issues).toEqual([
      { path: 'items.1.partId', message: 'Duplicated part.' },
    ]);
    expect(expectProblem(missing, 400, 'validation_failed').issues).toEqual([
      { path: 'items.0.partId', message: 'The part does not exist.' },
    ]);
    expect(repository.stored.get(project.id)).toMatchObject({ version: 1, items: [] });
  });

  it('treats a part id written in upper case as the same id, on create and on edit', async () => {
    const { app, repository } = setup();
    const project = repository.seed();

    const created = await request(app)
      .post(BASE)
      .send({ name: 'Mayúsculas', items: [{ partId: PART_A.toUpperCase(), quantity: 2 }] });
    const edited = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({ version: 1, items: [{ partId: PART_A.toUpperCase(), quantity: 3 }] });

    expect(created.status).toBe(201);
    expect((created.body as { items: { partId: string }[] }).items[0]?.partId).toBe(PART_A);
    expect(edited.status).toBe(200);
    expect((edited.body as { items: { partId: string }[] }).items[0]?.partId).toBe(PART_A);
  });

  it('sees the same id in two letter cases as a duplicate', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({
        name: 'Repetida',
        items: [
          { partId: PART_A, quantity: 1 },
          { partId: PART_A.toUpperCase(), quantity: 1 },
        ],
      });

    expect(expectProblem(response, 400, 'validation_failed').issues).toEqual([
      { path: 'items.1.partId', message: 'Duplicated part.' },
    ]);
  });

  it('answers 503 and changes nothing when the lookup fails', async () => {
    const { app, repository, parts } = setup();
    const project = repository.seed();
    parts.failWith = new Error('MongoServerSelectionError: ECONNREFUSED 10.1.2.3:27017');

    const response = await request(app)
      .patch(`${BASE}/${project.id}`)
      .send({ version: 1, items: [{ partId: PART_A, quantity: 1 }] });

    expectProblem(response, 503, 'service_unavailable');
    expect(JSON.stringify(response.body)).not.toMatch(/Mongo|ECONNREFUSED|10\.1\.2\.3/);
    expect(repository.stored.get(project.id)?.version).toBe(1);
  });
});

describe('DELETE /api/v1/projects/:id', () => {
  it('answers 204 with no body and then hides the project', async () => {
    const { app, repository } = setup();
    const project = repository.seed();

    const response = await request(app).delete(`${BASE}/${project.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect((await request(app).get(`${BASE}/${project.id}`)).status).toBe(404);
    expect(repository.stored.get(project.id)?.deletedAt).not.toBeNull();
  });

  it('answers 404 when the delete is repeated, for a missing project, and 400 for a bad id', async () => {
    const { app, repository } = setup();
    const project = repository.seed();
    await request(app).delete(`${BASE}/${project.id}`);

    expectProblem(await request(app).delete(`${BASE}/${project.id}`), 404, 'not_found');
    expectProblem(await request(app).delete(`${BASE}/${MISSING_ID}`), 404, 'not_found');
    expectProblem(await request(app).delete(`${BASE}/not-an-id`), 400, 'validation_failed');
  });
});

describe('dependency failure', () => {
  it('answers a generic 503 problem without driver text', async () => {
    const { app, repository } = setup();
    repository.failWith = new AppError(
      'service_unavailable',
      'The project data is temporarily unavailable.',
      { cause: new Error('MongoServerSelectionError: connect ECONNREFUSED 10.1.2.3:27017') },
    );

    for (const response of [
      await request(app).get(BASE),
      await request(app).post(BASE).send({ name: 'x' }),
      await request(app).delete(`${BASE}/${MISSING_ID}`),
    ]) {
      expectProblem(response, 503, 'service_unavailable');
      expect(JSON.stringify(response.body)).not.toMatch(/Mongo|ECONNREFUSED|10\.1\.2\.3/);
    }
  });

  it('answers a generic 500 problem for an unexpected error', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('E11000 duplicate key collection: print3d.projects index: x');

    const response = await request(app).get(`${BASE}/${MISSING_ID}`);

    expectProblem(response, 500, 'internal');
    expect(JSON.stringify(response.body)).not.toMatch(/E11000|duplicate key|print3d\.projects/);
  });
});
