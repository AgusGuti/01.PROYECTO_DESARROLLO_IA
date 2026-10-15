// API tests: the real Express app over HTTP, with an in-memory fake instead of MongoDB.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { filamentSchema } from './filaments.schemas.js';
import { createFakeFilamentRepository, createTestClock } from './testing/fakes.js';

const BASE = '/api/v1/filaments';
const MISSING_ID = '0'.repeat(24);

const body = {
  brand: 'Grilon3',
  material: 'PLA',
  colorName: 'Negro',
  initialGrams: 1000,
  purchaseCostMinor: 1_950_000,
  purchaseDate: '2026-02-01',
};

const DTO_KEYS = [
  'availableGrams',
  'brand',
  'colorName',
  'createdAt',
  'id',
  'initialGrams',
  'material',
  'purchaseCostMinor',
  'purchaseDate',
  'updatedAt',
  'version',
];

function setup() {
  const repository = createFakeFilamentRepository();
  const clock = createTestClock();
  const app = createTestApp({
    clock,
    env: { RATE_LIMIT_MAX: '100000' },
    filaments: { repository },
  });
  return { app, repository, clock };
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
  (response.body as { items: { brand: string }[] }).items.map((item) => item.brand);

describe('POST /api/v1/filaments', () => {
  it('creates a spool: 201, Location and the full DTO', async () => {
    const { app, clock } = setup();

    const response = await request(app).post(BASE).send(body);

    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    expect(response.headers['location']).toBe(`${BASE}/${id}`);
    expect(response.body).toEqual({
      id,
      brand: 'Grilon3',
      material: 'PLA',
      colorName: 'Negro',
      initialGrams: 1000,
      availableGrams: 1000,
      purchaseCostMinor: 1_950_000,
      purchaseDate: '2026-02-01',
      version: 1,
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    });
    filamentSchema.parse(response.body);
  });

  it('keeps a given availableGrams', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, availableGrams: 640 });

    expect(response.body).toHaveProperty('availableGrams', 640);
  });

  it('trims and normalises the brand and the colour', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, brand: '  Café  ', colorName: ' Azul ' });

    expect(response.body).toMatchObject({ brand: 'Café', colorName: 'Azul' });
  });

  it('creates two identical spools, both with 201', async () => {
    const { app, repository } = setup();

    const first = await request(app).post(BASE).send(body);
    const second = await request(app).post(BASE).send(body);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect((first.body as { id: string }).id).not.toBe((second.body as { id: string }).id);
    expect(repository.stored.size).toBe(2);
  });

  it.each(['id', '_id', 'version', 'deletedAt', 'createdAt', 'updatedAt', '$set', 'currency'])(
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

  it('rejects invalid input with per-field issues and does not echo the body', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, brand: 'SECRET-BRAND\n', initialGrams: 0, purchaseDate: '2026-02-30' });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['brand', 'initialGrams', 'purchaseDate']),
    );
    expect(JSON.stringify(response.body)).not.toContain('SECRET-BRAND');
    expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules|\.ts:/);
  });

  it('answers 400 on availableGrams when it exceeds initialGrams', async () => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, availableGrams: 1001 });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([{ path: 'availableGrams', message: expect.any(String) }]);
    expect(repository.calls).toEqual([]);
  });

  it('answers 400 on purchaseDate for tomorrow (UTC) and accepts today', async () => {
    const { app } = setup();

    const tomorrow = await request(app)
      .post(BASE)
      .send({ ...body, purchaseDate: '2026-03-02' });
    const today = await request(app)
      .post(BASE)
      .send({ ...body, purchaseDate: '2026-03-01' });

    const problem = expectProblem(tomorrow, 400, 'validation_failed');
    expect(problem.issues).toEqual([{ path: 'purchaseDate', message: expect.any(String) }]);
    expect(today.status).toBe(201);
  });

  it('answers 400 for a request without a JSON body', async () => {
    const { app } = setup();

    expectProblem(await request(app).post(BASE), 400, 'validation_failed');
  });
});

describe('GET /api/v1/filaments', () => {
  it('returns an empty first page', async () => {
    const { app } = setup();

    const response = await request(app).get(BASE);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('excludes deleted spools from items and total', async () => {
    const { app, repository } = setup();
    repository.seed({ brand: 'Live' });
    repository.seed({ brand: 'Gone', deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    const response = await request(app).get(BASE);

    expect(namesOf(response)).toEqual(['Live']);
    expect(response.body).toHaveProperty('total', 1);
  });

  it('pages through the results', async () => {
    const { app, repository } = setup();
    for (let n = 1; n <= 5; n += 1) repository.seed({ brand: `Brand ${String(n)}` });

    const response = await request(app).get(`${BASE}?page=2&pageSize=2&sort=brand&order=asc`);

    expect(response.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(namesOf(response)).toEqual(['Brand 3', 'Brand 4']);
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
    repository.seed({ brand: 'A', material: 'PETG' });
    repository.seed({ brand: 'B', material: 'PLA' });

    expect(namesOf(await request(app).get(`${BASE}?material=PETG`))).toEqual(['A']);
  });

  it('filters by stock: true needs grams left, false means empty', async () => {
    const { app, repository } = setup();
    repository.seed({ brand: 'Full' });
    repository.seed({ brand: 'Empty', availableGrams: 0 });

    expect(namesOf(await request(app).get(`${BASE}?inStock=true`))).toEqual(['Full']);
    expect(namesOf(await request(app).get(`${BASE}?inStock=false`))).toEqual(['Empty']);
  });

  it.each([
    ['purchaseDate', 'asc', ['Old', 'New']],
    ['purchaseDate', 'desc', ['New', 'Old']],
    ['availableGrams', 'asc', ['New', 'Old']],
    ['availableGrams', 'desc', ['Old', 'New']],
    ['brand', 'asc', ['New', 'Old']],
    ['createdAt', 'desc', ['New', 'Old']],
  ])('sorts by %s %s', async (sort, order, expected) => {
    const { app, repository } = setup();
    repository.seed({
      brand: 'Old',
      purchaseDate: new Date('2026-01-01T00:00:00.000Z'),
      availableGrams: 900,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    repository.seed({
      brand: 'New',
      purchaseDate: new Date('2026-02-01T00:00:00.000Z'),
      availableGrams: 100,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const response = await request(app).get(`${BASE}?sort=${sort}&order=${order}`);

    expect(namesOf(response)).toEqual(expected);
  });

  it.each([
    'material=SILK',
    'material[$ne]=x',
    'inStock=1',
    'inStock=true&inStock=false',
    'sort=deletedAt',
    'sort=__proto__',
    'sort=$natural',
    'order=up',
    'pageSize=0',
    'pageSize=101',
    'page=0',
    'page=10001',
    'page=abc',
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

describe('GET /api/v1/filaments/:id', () => {
  it('returns the full DTO and nothing internal', async () => {
    const { app, repository } = setup();
    const filament = repository.seed();

    const response = await request(app).get(`${BASE}/${filament.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: filament.id,
      brand: 'Grilon3',
      material: 'PLA',
      colorName: 'Negro',
      initialGrams: 1000,
      availableGrams: 1000,
      purchaseCostMinor: 1_950_000,
      purchaseDate: '2026-02-01',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('answers the same 404 for a missing and a deleted spool', async () => {
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

  it.each(['put', 'post'] as const)(
    'answers a problem body for an unsupported %s on an id',
    async (method) => {
      const { app, repository } = setup();
      const filament = repository.seed();

      const response = await request(app)[method](`${BASE}/${filament.id}`).send({});

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/problem+json');
    },
  );
});

describe('PATCH /api/v1/filaments/:id', () => {
  it('updates the spool and returns the new version', async () => {
    const { app, repository, clock } = setup();
    const filament = repository.seed();
    clock.advanceSeconds(30);

    const response = await request(app)
      .patch(`${BASE}/${filament.id}`)
      .send({ version: 1, colorName: 'Rojo', purchaseDate: '2026-02-15' });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object).sort()).toEqual(DTO_KEYS);
    expect(response.body).toMatchObject({
      colorName: 'Rojo',
      purchaseDate: '2026-02-15',
      version: 2,
      updatedAt: clock.now().toISOString(),
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it.each([
    ['a missing version', { colorName: 'Rojo' }],
    ['version 0', { version: 0, colorName: 'Rojo' }],
    ['a string version', { version: '1', colorName: 'Rojo' }],
    ['only the version', { version: 1 }],
    ['deletedAt', { version: 1, deletedAt: '2026-01-01T00:00:00.000Z' }],
    ['an operator key', { version: 1, $set: { brand: 'x' } }],
  ])('answers 400 for %s and leaves the spool untouched', async (_label, payload) => {
    const { app, repository } = setup();
    const filament = repository.seed();

    expectProblem(
      await request(app).patch(`${BASE}/${filament.id}`).send(payload),
      400,
      'validation_failed',
    );
    expect(repository.stored.get(filament.id)).toEqual(filament);
  });

  it('answers 409 with an issue on version when the version is stale', async () => {
    const { app, repository } = setup();
    const filament = repository.seed({ version: 4 });

    const response = await request(app)
      .patch(`${BASE}/${filament.id}`)
      .send({ version: 3, colorName: 'Rojo' });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([{ path: 'version', message: expect.any(String) }]);
    expect(repository.stored.get(filament.id)).toEqual(filament);
  });

  it('answers 400 on availableGrams when lowering initialGrams under what is left', async () => {
    const { app, repository } = setup();
    const filament = repository.seed({ availableGrams: 800 });

    const response = await request(app)
      .patch(`${BASE}/${filament.id}`)
      .send({ version: 1, initialGrams: 500 });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([{ path: 'availableGrams', message: expect.any(String) }]);
    expect(repository.stored.get(filament.id)).toEqual(filament);
  });

  it('answers 400 on purchaseDate for a future date', async () => {
    const { app, repository } = setup();
    const filament = repository.seed();

    const response = await request(app)
      .patch(`${BASE}/${filament.id}`)
      .send({ version: 1, purchaseDate: '2026-03-02' });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.[0]?.path).toBe('purchaseDate');
  });

  it('answers 400 before 409 when the body is invalid and the version is stale', async () => {
    const { app, repository } = setup();
    const filament = repository.seed({ version: 4 });

    expectProblem(
      await request(app).patch(`${BASE}/${filament.id}`).send({ version: 1, brand: '' }),
      400,
      'validation_failed',
    );
  });

  it('answers 409 before the domain 400 when the version is stale and the merged state is invalid', async () => {
    const { app, repository } = setup();
    const filament = repository.seed({ version: 4, initialGrams: 100, availableGrams: 50 });

    const response = await request(app)
      .patch(`${BASE}/${filament.id}`)
      .send({ version: 1, availableGrams: 500 });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues?.[0]?.path).toBe('version');
  });

  it('answers 404 before 409 for a missing spool with any version', async () => {
    const { app } = setup();

    expectProblem(
      await request(app).patch(`${BASE}/${MISSING_ID}`).send({ version: 9, brand: 'x' }),
      404,
      'not_found',
    );
  });

  it('answers 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(
      await request(app).patch(`${BASE}/nope`).send({ version: 1, brand: 'x' }),
      400,
      'validation_failed',
    );
  });
});

describe('DELETE /api/v1/filaments/:id', () => {
  it('answers 204 with no body and then hides the spool', async () => {
    const { app, repository } = setup();
    const filament = repository.seed();

    const response = await request(app).delete(`${BASE}/${filament.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect((await request(app).get(`${BASE}/${filament.id}`)).status).toBe(404);
    expect(repository.stored.get(filament.id)?.deletedAt).not.toBeNull();
  });

  it('answers 404 when the delete is repeated', async () => {
    const { app, repository } = setup();
    const filament = repository.seed();
    await request(app).delete(`${BASE}/${filament.id}`);

    expectProblem(await request(app).delete(`${BASE}/${filament.id}`), 404, 'not_found');
  });

  it('answers 404 for a missing spool and 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(await request(app).delete(`${BASE}/${MISSING_ID}`), 404, 'not_found');
    expectProblem(await request(app).delete(`${BASE}/not-an-id`), 400, 'validation_failed');
  });
});

describe('POST /api/v1/filaments/:id/consume', () => {
  it('takes the grams and returns the updated DTO', async () => {
    const { app, repository, clock } = setup();
    const filament = repository.seed({ availableGrams: 500 });
    clock.advanceSeconds(10);

    const response = await request(app).post(`${BASE}/${filament.id}/consume`).send({ grams: 120 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: filament.id,
      brand: 'Grilon3',
      material: 'PLA',
      colorName: 'Negro',
      initialGrams: 1000,
      availableGrams: 380,
      purchaseCostMinor: 1_950_000,
      purchaseDate: '2026-02-01',
      version: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: clock.now().toISOString(),
    });
  });

  it('allows taking exactly what is left', async () => {
    const { app, repository } = setup();
    const filament = repository.seed({ availableGrams: 50 });

    const response = await request(app).post(`${BASE}/${filament.id}/consume`).send({ grams: 50 });

    expect(response.body).toHaveProperty('availableGrams', 0);
  });

  it('answers 409 on grams without numbers in the body and leaves the spool unchanged', async () => {
    const { app, repository } = setup();
    const filament = repository.seed({ availableGrams: 50 });

    const response = await request(app).post(`${BASE}/${filament.id}/consume`).send({ grams: 51 });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([{ path: 'grams', message: 'Not enough material available.' }]);
    expect(problem.detail).toBe('Not enough material available.');
    expect(JSON.stringify(response.body)).not.toMatch(/availableGrams|\b50\b|\b51\b/);
    expect(repository.stored.get(filament.id)).toEqual(filament);
  });

  it.each([
    ['0', { grams: 0 }],
    ['-1', { grams: -1 }],
    ['1.5', { grams: 1.5 }],
    ['a string', { grams: '5' }],
    ['20001', { grams: 20_001 }],
    ['an extra key', { grams: 5, version: 1 }],
    ['an empty body', {}],
  ])('answers 400 for grams %s without calling the repository', async (_label, payload) => {
    const { app, repository } = setup();
    const filament = repository.seed();

    const response = await request(app).post(`${BASE}/${filament.id}/consume`).send(payload);

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('answers 404 for a missing and for a deleted spool', async () => {
    const { app, repository } = setup();
    const gone = repository.seed({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    expectProblem(
      await request(app).post(`${BASE}/${MISSING_ID}/consume`).send({ grams: 1 }),
      404,
      'not_found',
    );
    expectProblem(
      await request(app).post(`${BASE}/${gone.id}/consume`).send({ grams: 1 }),
      404,
      'not_found',
    );
  });

  it('answers 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(
      await request(app).post(`${BASE}/nope/consume`).send({ grams: 1 }),
      400,
      'validation_failed',
    );
  });
});

describe('dependency failure', () => {
  it('answers a generic 503 problem without driver text', async () => {
    const { app, repository } = setup();
    repository.failWith = new AppError(
      'service_unavailable',
      'The filament data is temporarily unavailable.',
      { cause: new Error('MongoServerSelectionError: connect ECONNREFUSED 10.1.2.3:27017') },
    );

    for (const response of [
      await request(app).get(BASE),
      await request(app).post(BASE).send(body),
      await request(app).post(`${BASE}/${MISSING_ID}/consume`).send({ grams: 1 }),
    ]) {
      expectProblem(response, 503, 'service_unavailable');
      expect(JSON.stringify(response.body)).not.toMatch(/Mongo|ECONNREFUSED|10\.1\.2\.3/);
    }
  });

  it('answers a generic 500 problem for an unexpected error', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('E11000 duplicate key collection: print3d.filaments index: x');

    const response = await request(app).get(`${BASE}/${MISSING_ID}`);

    expectProblem(response, 500, 'internal');
    expect(JSON.stringify(response.body)).not.toMatch(/E11000|duplicate key|print3d\.filaments/);
  });
});
