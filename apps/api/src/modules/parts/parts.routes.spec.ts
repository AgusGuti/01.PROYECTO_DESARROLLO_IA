// API tests: the real Express app over HTTP, with an in-memory fake instead of MongoDB.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { partSchema } from './parts.schemas.js';
import { createFakePartRepository, createFakePartUsage, createTestClock } from './testing/fakes.js';

const BASE = '/api/v1/parts';
const MISSING_ID = '0'.repeat(24);

const body = {
  name: 'Soporte de estante en L',
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: 5700,
  layerHeightUm: 200,
};

const gcodeSource = { kind: 'gcode', fileName: 'florero-espiral.gcode', slicer: 'cura' } as const;

const DTO_KEYS = [
  'createdAt',
  'description',
  'dimensionsMm',
  'estimatedPrintSeconds',
  'estimatedWeightGrams',
  'id',
  'layerHeightUm',
  'material',
  'name',
  'source',
  'suggestedPrinterName',
  'updatedAt',
  'version',
];

function setup() {
  const repository = createFakePartRepository();
  const clock = createTestClock();
  // Deleting asks the projects module, which would hit the real database: inject a fake.
  const partUsage = createFakePartUsage();
  const app = createTestApp({
    clock,
    env: { RATE_LIMIT_MAX: '100000' },
    parts: { repository, partUsage },
  });
  return { app, repository, clock, partUsage };
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

describe('POST /api/v1/parts', () => {
  it('creates a part: 201, Location and the full DTO with a manual source', async () => {
    const { app, clock } = setup();

    const response = await request(app).post(BASE).send(body);

    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    expect(response.headers['location']).toBe(`${BASE}/${id}`);
    expect(response.body).toEqual({
      id,
      name: 'Soporte de estante en L',
      description: null,
      material: 'PETG',
      dimensionsMm: { x: 60, y: 40, z: 25 },
      estimatedWeightGrams: 38,
      estimatedPrintSeconds: 5700,
      layerHeightUm: 200,
      suggestedPrinterName: null,
      source: { kind: 'manual' },
      version: 1,
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    });
    partSchema.parse(response.body);
  });

  it('stamps analyzedAt on a gcode source from the server clock', async () => {
    const { app, clock } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, source: gcodeSource, description: 'Con espiral' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      description: 'Con espiral',
      source: { ...gcodeSource, analyzedAt: clock.now().toISOString() },
    });
  });

  it('trims and normalises the texts', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, name: '  Café  ', suggestedPrinterName: ' Ender ' });

    expect(response.body).toMatchObject({ name: 'Café', suggestedPrinterName: 'Ender' });
  });

  it('creates two parts with the same name, both with 201', async () => {
    const { app, repository } = setup();

    const first = await request(app).post(BASE).send(body);
    const second = await request(app).post(BASE).send(body);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect((first.body as { id: string }).id).not.toBe((second.body as { id: string }).id);
    expect(repository.stored.size).toBe(2);
  });

  it.each(['id', '_id', 'version', 'deletedAt', 'createdAt', 'updatedAt', 'analyzedAt', '$set'])(
    'rejects the key %s without calling the repository',
    async (key) => {
      const { app, repository } = setup();

      const response = await request(app)
        .post(BASE)
        .send({ ...body, [key]: 1 });

      expectProblem(response, 400, 'validation_failed');
      expect(repository.calls).toEqual([]);
    },
  );

  it.each([
    ['analyzedAt inside the source', { ...gcodeSource, analyzedAt: '2020-01-01T00:00:00.000Z' }],
    ['an unknown key inside the source', { ...gcodeSource, path: '/tmp' }],
    ['a gcode source without a fileName', { kind: 'gcode', slicer: 'cura' }],
    ['an unknown slicer', { ...gcodeSource, slicer: 'x' }],
    ['an unknown kind', { kind: 'upload' }],
  ])('rejects %s without calling the repository', async (_label, source) => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, source });

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('rejects an unknown key inside dimensionsMm', async () => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, dimensionsMm: { x: 1, y: 1, z: 1, w: 1 } });

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('rejects an own __proto__ key sent as raw JSON', async () => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(BASE)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body).replace('{', '{"__proto__":{"admin":true},'));

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('rejects invalid input with per-field issues and does not echo the body', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, name: 'SECRET-NAME\n', estimatedWeightGrams: 0, layerHeightUm: 9 });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['name', 'estimatedWeightGrams', 'layerHeightUm']),
    );
    expect(JSON.stringify(response.body)).not.toContain('SECRET-NAME');
    expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules|\.ts:/);
  });

  it('answers 400 for a request without a JSON body', async () => {
    const { app } = setup();

    expectProblem(await request(app).post(BASE), 400, 'validation_failed');
  });
});

describe('GET /api/v1/parts', () => {
  it('returns an empty first page', async () => {
    const { app } = setup();

    const response = await request(app).get(BASE);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('excludes deleted parts from items and total', async () => {
    const { app, repository } = setup();
    repository.seed({ name: 'Live' });
    repository.seed({ name: 'Gone', deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    const response = await request(app).get(BASE);

    expect(namesOf(response)).toEqual(['Live']);
    expect(response.body).toHaveProperty('total', 1);
  });

  it('sorts by name ascending by default', async () => {
    const { app, repository } = setup();
    repository.seed({ name: 'banana' });
    repository.seed({ name: 'Apple' });

    expect(namesOf(await request(app).get(BASE))).toEqual(['Apple', 'banana']);
  });

  it('pages through the results', async () => {
    const { app, repository } = setup();
    for (let n = 1; n <= 5; n += 1) repository.seed({ name: `Part ${String(n)}` });

    const response = await request(app).get(`${BASE}?page=2&pageSize=2`);

    expect(response.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(namesOf(response)).toEqual(['Part 3', 'Part 4']);
  });

  it('accepts the page and size boundaries', async () => {
    const { app } = setup();

    expect((await request(app).get(`${BASE}?page=10000&pageSize=100`)).status).toBe(200);
    expect((await request(app).get(`${BASE}?page=1&pageSize=1`)).status).toBe(200);
  });

  it('answers 200 with no items and the real total past the last page', async () => {
    const { app, repository } = setup();
    repository.seed();

    const response = await request(app).get(`${BASE}?page=50`);

    expect(response.body).toEqual({ items: [], page: 50, pageSize: 20, total: 1 });
  });

  it('filters by material', async () => {
    const { app, repository } = setup();
    repository.seed({ name: 'A', material: 'PETG' });
    repository.seed({ name: 'B', material: 'PLA' });

    expect(namesOf(await request(app).get(`${BASE}?material=PETG`))).toEqual(['A']);
  });

  it.each([
    ['name', 'asc', ['Apple', 'Zeta']],
    ['name', 'desc', ['Zeta', 'Apple']],
    ['estimatedWeightGrams', 'asc', ['Zeta', 'Apple']],
    ['estimatedWeightGrams', 'desc', ['Apple', 'Zeta']],
    ['estimatedPrintSeconds', 'asc', ['Apple', 'Zeta']],
    ['estimatedPrintSeconds', 'desc', ['Zeta', 'Apple']],
    ['createdAt', 'asc', ['Zeta', 'Apple']],
    ['createdAt', 'desc', ['Apple', 'Zeta']],
  ])('sorts by %s %s', async (sort, order, expected) => {
    const { app, repository } = setup();
    repository.seed({
      name: 'Zeta',
      estimatedWeightGrams: 10,
      estimatedPrintSeconds: 9000,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    repository.seed({
      name: 'Apple',
      estimatedWeightGrams: 90,
      estimatedPrintSeconds: 100,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const response = await request(app).get(`${BASE}?sort=${sort}&order=${order}`);

    expect(namesOf(response)).toEqual(expected);
  });

  it.each([
    'material=SILK',
    'material[$ne]=x',
    'sort=deletedAt',
    'sort=__proto__',
    'sort=$natural',
    'sort=description',
    'order=up',
    'pageSize=0',
    'pageSize=101',
    'page=0',
    'page=10001',
    'page=abc',
    'q=florero',
    'unknown=1',
    '$where=1',
  ])('rejects the query "%s" with 400 without calling the repository', async (query) => {
    const { app, repository } = setup();

    expectProblem(await request(app).get(`${BASE}?${query}`), 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('exposes exactly the DTO keys', async () => {
    const { app, repository } = setup();
    repository.seed();

    const response = await request(app).get(BASE);

    const item = (response.body as { items: object[] }).items[0];
    expect(Object.keys(item ?? {}).sort()).toEqual(DTO_KEYS);
  });
});

describe('GET /api/v1/parts/:id', () => {
  it('returns the full DTO and nothing internal', async () => {
    const { app, repository } = setup();
    const part = repository.seed({
      description: 'Con espiral',
      source: { ...gcodeSource, analyzedAt: new Date('2026-02-01T08:00:00.000Z') },
    });

    const response = await request(app).get(`${BASE}/${part.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: part.id,
      name: 'Soporte de estante en L',
      description: 'Con espiral',
      material: 'PETG',
      dimensionsMm: { x: 60, y: 40, z: 25 },
      estimatedWeightGrams: 38,
      estimatedPrintSeconds: 5700,
      layerHeightUm: 200,
      suggestedPrinterName: null,
      source: { ...gcodeSource, analyzedAt: '2026-02-01T08:00:00.000Z' },
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(response.body).not.toHaveProperty('deletedAt');
    expect(response.body).not.toHaveProperty('_id');
    expect(response.body).not.toHaveProperty('__v');
  });

  it('answers the same 404 for a missing and a deleted part', async () => {
    const { app, repository } = setup();
    const deleted = repository.seed({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    const missing = await request(app).get(`${BASE}/${MISSING_ID}`);
    const gone = await request(app).get(`${BASE}/${deleted.id}`);

    expectProblem(missing, 404, 'not_found');
    expectProblem(gone, 404, 'not_found');
    expect(Object.keys(gone.body as object).sort()).toEqual(
      Object.keys(missing.body as object).sort(),
    );
  });

  it.each(['abc', '12345678901234567890123', '{"$ne":1}', 'zzzzzzzzzzzzzzzzzzzzzzzz'])(
    'answers 400 for the malformed id "%s"',
    async (id) => {
      const { app, repository } = setup();

      const response = await request(app).get(`${BASE}/${encodeURIComponent(id)}`);

      expectProblem(response, 400, 'validation_failed');
      expect(repository.calls).toEqual([]);
    },
  );
});

describe('PATCH /api/v1/parts/:id', () => {
  it('updates the part and returns the new version', async () => {
    const { app, repository, clock } = setup();
    const part = repository.seed();
    clock.advanceSeconds(30);

    const response = await request(app)
      .patch(`${BASE}/${part.id}`)
      .send({ version: 1, name: 'Otro', dimensionsMm: { x: 5, y: 6, z: 7 } });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object).sort()).toEqual(DTO_KEYS);
    expect(response.body).toMatchObject({
      name: 'Otro',
      dimensionsMm: { x: 5, y: 6, z: 7 },
      version: 2,
      updatedAt: clock.now().toISOString(),
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('clears the description and the suggested printer with null', async () => {
    const { app, repository } = setup();
    const part = repository.seed({ description: 'Algo', suggestedPrinterName: 'Ender' });

    const response = await request(app)
      .patch(`${BASE}/${part.id}`)
      .send({ version: 1, description: null, suggestedPrinterName: null });

    expect(response.body).toMatchObject({ description: null, suggestedPrinterName: null });
  });

  it('stamps a new analyzedAt only when the body carries a source', async () => {
    const { app, repository, clock } = setup();
    const part = repository.seed();
    clock.advanceSeconds(60);

    const withSource = await request(app)
      .patch(`${BASE}/${part.id}`)
      .send({ version: 1, source: gcodeSource });
    clock.advanceSeconds(60);
    const withoutSource = await request(app)
      .patch(`${BASE}/${part.id}`)
      .send({ version: 2, name: 'Otro' });

    expect(withSource.body).toMatchObject({
      source: { ...gcodeSource, analyzedAt: '2026-03-01T10:01:00.000Z' },
    });
    expect(withoutSource.body).toMatchObject({
      source: { ...gcodeSource, analyzedAt: '2026-03-01T10:01:00.000Z' },
      version: 3,
    });
  });

  it.each([
    ['a missing version', { name: 'Otro' }],
    ['version 0', { version: 0, name: 'Otro' }],
    ['a string version', { version: '1', name: 'Otro' }],
    ['only the version', { version: 1 }],
    ['deletedAt', { version: 1, deletedAt: '2026-01-01T00:00:00.000Z' }],
    ['an operator key', { version: 1, $set: { name: 'x' } }],
    ['a client analyzedAt', { version: 1, source: { ...gcodeSource, analyzedAt: 'x' } }],
    ['a partial dimensionsMm', { version: 1, dimensionsMm: { x: 5 } }],
  ])('answers 400 for %s and leaves the part untouched', async (_label, payload) => {
    const { app, repository } = setup();
    const part = repository.seed();

    expectProblem(
      await request(app).patch(`${BASE}/${part.id}`).send(payload),
      400,
      'validation_failed',
    );
    expect(repository.stored.get(part.id)).toEqual(part);
    expect(repository.calls).toEqual([]);
  });

  it('answers 409 with an issue on version when the version is stale', async () => {
    const { app, repository } = setup();
    const part = repository.seed({ version: 4 });

    const response = await request(app)
      .patch(`${BASE}/${part.id}`)
      .send({ version: 3, name: 'Otro' });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([{ path: 'version', message: expect.any(String) }]);
    expect(repository.stored.get(part.id)).toEqual(part);
  });

  it('answers 400 before 409 when the body is invalid and the version is stale', async () => {
    const { app, repository } = setup();
    const part = repository.seed({ version: 4 });

    expectProblem(
      await request(app).patch(`${BASE}/${part.id}`).send({ version: 1, name: '' }),
      400,
      'validation_failed',
    );
  });

  it('answers 404 before 409 for a missing part with any version', async () => {
    const { app } = setup();

    expectProblem(
      await request(app).patch(`${BASE}/${MISSING_ID}`).send({ version: 9, name: 'x' }),
      404,
      'not_found',
    );
  });

  it('answers 404 for a deleted part', async () => {
    const { app, repository } = setup();
    const gone = repository.seed({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    expectProblem(
      await request(app).patch(`${BASE}/${gone.id}`).send({ version: 1, name: 'x' }),
      404,
      'not_found',
    );
  });

  it('answers 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(
      await request(app).patch(`${BASE}/nope`).send({ version: 1, name: 'x' }),
      400,
      'validation_failed',
    );
  });
});

describe('DELETE /api/v1/parts/:id', () => {
  it('answers 204 with no body and then hides the part', async () => {
    const { app, repository } = setup();
    const part = repository.seed();

    const response = await request(app).delete(`${BASE}/${part.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect((await request(app).get(`${BASE}/${part.id}`)).status).toBe(404);
    expect(repository.stored.get(part.id)?.deletedAt).not.toBeNull();
  });

  it('answers 404 when the delete is repeated', async () => {
    const { app, repository } = setup();
    const part = repository.seed();
    await request(app).delete(`${BASE}/${part.id}`);

    expectProblem(await request(app).delete(`${BASE}/${part.id}`), 404, 'not_found');
  });

  it('answers 404 for a missing part and 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(await request(app).delete(`${BASE}/${MISSING_ID}`), 404, 'not_found');
    expectProblem(await request(app).delete(`${BASE}/not-an-id`), 400, 'validation_failed');
  });
});

describe('DELETE /api/v1/parts/:id when projects use the part', () => {
  const used = {
    total: 3,
    projects: [{ id: 'a'.repeat(24), name: 'Soportes para el taller', quantity: 6 }],
  };

  it('answers a fixed 409 with one issue on projects and deletes nothing', async () => {
    const { app, repository, partUsage } = setup();
    const part = repository.seed();
    partUsage.report = used;

    const response = await request(app).delete(`${BASE}/${part.id}`);

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.detail).toBe('The part is used by one or more projects.');
    expect(problem.issues).toEqual([
      { path: 'projects', message: 'Remove the part from the projects first.' },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('Soportes');
    expect(repository.stored.get(part.id)?.deletedAt).toBeNull();
  });

  it('removeFromProjects=true pulls the part and answers 204', async () => {
    const { app, repository, partUsage } = setup();
    const part = repository.seed();
    partUsage.report = used;

    const response = await request(app)
      .delete(`${BASE}/${part.id}`)
      .query({ removeFromProjects: 'true' });

    expect(response.status).toBe(204);
    expect(partUsage.calls).toContain(`removeFromProjects:${part.id}`);
    expect(repository.stored.get(part.id)?.deletedAt).not.toBeNull();
  });

  it('removeFromProjects=false behaves like no flag', async () => {
    const { app, repository, partUsage } = setup();
    const part = repository.seed();
    partUsage.report = used;

    const response = await request(app)
      .delete(`${BASE}/${part.id}`)
      .query({ removeFromProjects: 'false' });

    expectProblem(response, 409, 'conflict');
  });

  it.each([
    ['a value that is not true or false', { removeFromProjects: 'yes' }],
    ['an uppercase value', { removeFromProjects: 'TRUE' }],
    ['an unknown key', { force: 'true' }],
    ['a repeated flag', { removeFromProjects: ['true', 'false'] }],
  ])('rejects %s with 400 before touching anything', async (_label, query) => {
    const { app, repository, partUsage } = setup();
    const part = repository.seed();
    repository.calls.length = 0;

    expectProblem(
      await request(app).delete(`${BASE}/${part.id}`).query(query),
      400,
      'validation_failed',
    );
    expect(repository.calls).toEqual([]);
    expect(partUsage.calls).toEqual([]);
  });

  it('answers 404 and pulls nothing for a missing part even with the flag', async () => {
    const { app, partUsage } = setup();

    const response = await request(app)
      .delete(`${BASE}/${MISSING_ID}`)
      .query({ removeFromProjects: 'true' });

    expectProblem(response, 404, 'not_found');
    expect(partUsage.calls).toEqual([]);
  });

  it('answers a generic 503 and keeps the part when the project data is unavailable', async () => {
    const { app, repository, partUsage } = setup();
    const part = repository.seed();
    partUsage.failWith = new Error('MongoServerSelectionError: ECONNREFUSED 10.1.2.3:27017');

    for (const query of [{}, { removeFromProjects: 'true' }]) {
      const response = await request(app).delete(`${BASE}/${part.id}`).query(query);
      expectProblem(response, 503, 'service_unavailable');
      expect(JSON.stringify(response.body)).not.toMatch(/Mongo|ECONNREFUSED|10\.1\.2\.3/);
    }
    expect(repository.stored.get(part.id)?.deletedAt).toBeNull();
  });
});

describe('GET /api/v1/parts/:id/usage', () => {
  it('returns the true total and at most 50 projects with exactly the DTO keys', async () => {
    const { app, repository, partUsage } = setup();
    const part = repository.seed();
    partUsage.report = {
      total: 75,
      projects: Array.from({ length: 75 }, (_v, i) => ({
        id: i.toString(16).padStart(24, '0'),
        name: `P${String(i)}`,
        quantity: 2,
      })),
    };

    const response = await request(app).get(`${BASE}/${part.id}/usage`);

    expect(response.status).toBe(200);
    const body = response.body as { total: number; projects: Record<string, unknown>[] };
    expect(Object.keys(body).sort()).toEqual(['projects', 'total']);
    expect(body.total).toBe(75);
    expect(body.projects).toHaveLength(50);
    expect(body.projects[0]).toEqual({ id: '0'.repeat(24), name: 'P0', quantity: 2 });
  });

  it('is empty for an unused part', async () => {
    const { app, repository } = setup();
    const part = repository.seed();

    const response = await request(app).get(`${BASE}/${part.id}/usage`);

    expect(response.body).toEqual({ total: 0, projects: [] });
  });

  it('answers 404 for a missing or deleted part and 400 for a malformed id', async () => {
    const { app, repository } = setup();
    const gone = repository.seed({ deletedAt: new Date() });

    expectProblem(await request(app).get(`${BASE}/${MISSING_ID}/usage`), 404, 'not_found');
    expectProblem(await request(app).get(`${BASE}/${gone.id}/usage`), 404, 'not_found');
    expectProblem(await request(app).get(`${BASE}/nope/usage`), 400, 'validation_failed');
  });

  it('answers 503 when the project data is unavailable', async () => {
    const { app, repository, partUsage } = setup();
    const part = repository.seed();
    partUsage.failWith = new Error('boom');

    expectProblem(await request(app).get(`${BASE}/${part.id}/usage`), 503, 'service_unavailable');
  });
});

describe('dependency failure', () => {
  it('answers a generic 503 problem without driver text', async () => {
    const { app, repository } = setup();
    repository.failWith = new AppError(
      'service_unavailable',
      'The part data is temporarily unavailable.',
      { cause: new Error('MongoServerSelectionError: connect ECONNREFUSED 10.1.2.3:27017') },
    );

    for (const response of [
      await request(app).get(BASE),
      await request(app).post(BASE).send(body),
      await request(app).delete(`${BASE}/${MISSING_ID}`),
    ]) {
      expectProblem(response, 503, 'service_unavailable');
      expect(JSON.stringify(response.body)).not.toMatch(/Mongo|ECONNREFUSED|10\.1\.2\.3/);
    }
  });

  it('answers a generic 500 problem for an unexpected error', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('E11000 duplicate key collection: print3d.parts index: x');

    const response = await request(app).get(`${BASE}/${MISSING_ID}`);

    expectProblem(response, 500, 'internal');
    expect(JSON.stringify(response.body)).not.toMatch(/E11000|duplicate key|print3d\.parts/);
  });
});
