// API tests: the real Express app over HTTP, with an in-memory fake instead of MongoDB.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import type { PrinterUsageCheck } from './index.js';
import { printerSchema } from './printers.schemas.js';
import { createFakePrinterRepository, createTestClock } from './testing/fakes.js';

const BASE = '/api/v1/printers';
const MISSING_ID = '0'.repeat(24);

const body = {
  name: 'Ender 3',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.4, material: 'brass' },
  compatibleMaterials: ['PLA', 'PETG'],
  typicalSpeedMmS: 60,
  powerWatts: 150,
};

function setup(hasAssignments?: PrinterUsageCheck) {
  const repository = createFakePrinterRepository();
  const clock = createTestClock();
  const app = createTestApp({
    clock,
    env: { RATE_LIMIT_MAX: '100000' },
    printers: { repository, ...(hasAssignments === undefined ? {} : { hasAssignments }) },
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

describe('POST /api/v1/printers', () => {
  it('creates a printer: 201, Location and the full DTO', async () => {
    const { app, clock } = setup();

    const response = await request(app).post(BASE).send(body);

    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    expect(response.headers['location']).toBe(`${BASE}/${id}`);
    expect(response.body).toEqual({
      id,
      name: 'Ender 3',
      buildVolume: { x: 220, y: 220, z: 250 },
      nozzle: { diameterMm: 0.4, material: 'brass' },
      compatibleMaterials: ['PLA', 'PETG'],
      typicalSpeedMmS: 60,
      powerWatts: 150,
      status: 'available',
      version: 1,
      archivedAt: null,
      createdAt: clock.now().toISOString(),
      updatedAt: clock.now().toISOString(),
    });
    printerSchema.parse(response.body);
  });

  it('shows a missing speed as null', async () => {
    const { app } = setup();
    const { typicalSpeedMmS: _speed, ...withoutSpeed } = body;

    const response = await request(app).post(BASE).send(withoutSpeed);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('typicalSpeedMmS', null);
  });

  it('shows a missing power as null', async () => {
    const { app } = setup();
    const { powerWatts: _power, ...withoutPower } = body;

    const response = await request(app).post(BASE).send(withoutPower);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('powerWatts', null);
  });

  it.each([0, 5001, 1.5, '150', null])(
    'rejects a power of %s with 400 and writes nothing',
    async (powerWatts) => {
      const { app, repository } = setup();

      const response = await request(app)
        .post(BASE)
        .send({ ...body, powerWatts });

      expectProblem(response, 400, 'validation_failed');
      expect(repository.calls).toEqual([]);
    },
  );

  it.each([0, 5001, 1.5])('rejects a patch with a power of %s', async (powerWatts) => {
    const { app, repository } = setup();
    const printer = repository.seed();

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, powerWatts });

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('trims and normalises the name', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, name: '  Café  ' });

    expect(response.body).toHaveProperty('name', 'Café');
  });

  it.each(['version', 'createdAt', 'updatedAt', 'archivedAt', 'deletedAt', 'id', '_id'])(
    'rejects the server-owned field %s as an unknown key',
    async (field) => {
      const { app, repository } = setup();

      const response = await request(app)
        .post(BASE)
        .send({ ...body, [field]: field === 'version' ? 5 : null });

      expectProblem(response, 400, 'validation_failed');
      expect(repository.calls).toEqual([]);
    },
  );

  it('rejects invalid input with per-field issues and does not echo the body', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, name: 'SECRET-NAME\n', buildVolume: { x: 0, y: 1, z: 1 } });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['name', 'buildVolume.x']),
    );
    expect(JSON.stringify(response.body)).not.toContain('SECRET-NAME');
    expect(JSON.stringify(response.body)).not.toMatch(/stack|node_modules|\.ts:/);
  });

  it('answers 400 with an issue on compatibleMaterials for a reinforced material on brass', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(BASE)
      .send({ ...body, compatibleMaterials: ['PLA', 'PA_CF'] });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([
      { path: 'compatibleMaterials', message: expect.stringContaining('PA_CF') },
    ]);
  });

  it('answers 400 for a request without a JSON body', async () => {
    const { app } = setup();

    const response = await request(app).post(BASE);

    expectProblem(response, 400, 'validation_failed');
  });

  it('answers 409 with an issue on name for a duplicate, ignoring case', async () => {
    const { app } = setup();
    await request(app).post(BASE).send(body);

    const response = await request(app)
      .post(BASE)
      .send({ ...body, name: 'ENDER 3' });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([{ path: 'name', message: expect.any(String) }]);
  });

  describe('when a deleted printer holds the name', () => {
    const deletedAt = new Date('2026-02-01T00:00:00.000Z');

    it('answers 409 on restoreIfDeleted, without the id or the old data', async () => {
      const { app, repository } = setup();
      const old = repository.seed({
        deletedAt,
        typicalSpeedMmS: 777,
        buildVolume: { x: 321, y: 322, z: 323 },
      });

      const response = await request(app).post(BASE).send(body);

      const problem = expectProblem(response, 409, 'conflict');
      expect(problem.issues).toEqual([{ path: 'restoreIfDeleted', message: expect.any(String) }]);
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(old.id);
      // Look for the old data as whole JSON values and keys, not as loose digits: the random
      // request id in the body can contain any digits by chance.
      expect(text).not.toMatch(/[:,[]\s*(777|321|322|323)\s*[,}\]]/);
      expect(text).not.toContain('typicalSpeedMmS');
      expect(text).not.toContain('buildVolume');
      expect(repository.stored.get(old.id)).toEqual(old);
    });

    it('tells the two conflicts apart by the issue path', async () => {
      const { app, repository } = setup();
      repository.seed({ name: 'Gone', deletedAt });
      repository.seed({ name: 'Here' });

      const deleted = await request(app)
        .post(BASE)
        .send({ ...body, name: 'gone' });
      const live = await request(app)
        .post(BASE)
        .send({ ...body, name: 'HERE' });

      expect(problemSchema.parse(deleted.body).issues?.[0]?.path).toBe('restoreIfDeleted');
      expect(problemSchema.parse(live.body).issues?.[0]?.path).toBe('name');
    });

    it('answers 409 on restoreIfDeleted when the flag is explicitly false', async () => {
      const { app, repository } = setup();
      repository.seed({ deletedAt });

      const response = await request(app)
        .post(BASE)
        .send({ ...body, restoreIfDeleted: false });

      expectProblem(response, 409, 'conflict');
    });

    it('restores it with 200, Location and the submitted data when the flag is true', async () => {
      const { app, repository, clock } = setup();
      const old = repository.seed({ deletedAt, typicalSpeedMmS: 99 });
      const { typicalSpeedMmS: _speed, powerWatts: _power, ...withoutSpeed } = body;

      const response = await request(app)
        .post(BASE)
        .send({ ...withoutSpeed, name: 'ENDER 3', status: 'maintenance', restoreIfDeleted: true });

      expect(response.status).toBe(200);
      expect(response.headers['location']).toBe(`${BASE}/${old.id}`);
      expect(response.body).toEqual({
        id: old.id,
        name: 'ENDER 3',
        buildVolume: { x: 220, y: 220, z: 250 },
        nozzle: { diameterMm: 0.4, material: 'brass' },
        compatibleMaterials: ['PLA', 'PETG'],
        typicalSpeedMmS: null,
        powerWatts: null,
        status: 'maintenance',
        version: 2,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: clock.now().toISOString(),
      });
      expect((await request(app).get(`${BASE}/${old.id}`)).status).toBe(200);
    });

    it('answers 400 and leaves the deleted printer alone when the restore breaks a rule', async () => {
      const { app, repository } = setup();
      const old = repository.seed({ deletedAt });

      const response = await request(app)
        .post(BASE)
        .send({ ...body, compatibleMaterials: ['PA_CF'], restoreIfDeleted: true });

      expectProblem(response, 400, 'validation_failed');
      expect(repository.stored.get(old.id)).toEqual(old);
    });

    it('creates with 201 when the flag is true and no deleted printer matches', async () => {
      const { app } = setup();

      const response = await request(app)
        .post(BASE)
        .send({ ...body, restoreIfDeleted: true });

      expect(response.status).toBe(201);
      expect(response.body).not.toHaveProperty('restoreIfDeleted');
    });

    it('answers 409 on name for a pending-removal printer even with the flag', async () => {
      const { app, repository } = setup();
      repository.seed({ archivedAt: deletedAt });

      const response = await request(app)
        .post(BASE)
        .send({ ...body, restoreIfDeleted: true });

      const problem = expectProblem(response, 409, 'conflict');
      expect(problem.issues?.[0]?.path).toBe('name');
    });

    it.each(['true', 1, null])('answers 400 for restoreIfDeleted of %j', async (flag) => {
      const { app, repository } = setup();

      const response = await request(app)
        .post(BASE)
        .send({ ...body, restoreIfDeleted: flag });

      expectProblem(response, 400, 'validation_failed');
      expect(repository.calls).toEqual([]);
    });
  });
});

describe('POST /api/v1/printers/:id/unarchive', () => {
  const archivedAt = new Date('2026-02-01T00:00:00.000Z');

  it('answers 200 with the printer, no longer archived, and the version bumped', async () => {
    const { app, repository, clock } = setup();
    const printer = repository.seed({ archivedAt });

    const response = await request(app).post(`${BASE}/${printer.id}/unarchive`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: printer.id,
      name: 'Ender 3',
      buildVolume: { x: 220, y: 220, z: 250 },
      nozzle: { diameterMm: 0.4, material: 'brass' },
      compatibleMaterials: ['PLA', 'PETG'],
      typicalSpeedMmS: 60,
      powerWatts: 150,
      status: 'available',
      version: 2,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: clock.now().toISOString(),
    });
  });

  it('lets the printer be edited again afterwards', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ archivedAt });
    await request(app).post(`${BASE}/${printer.id}/unarchive`);

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 2, name: 'Prusa' });

    expect(response.status).toBe(200);
  });

  it('answers 200 with no change for a printer that is not archived', async () => {
    const { app, repository } = setup();
    const printer = repository.seed();

    const response = await request(app).post(`${BASE}/${printer.id}/unarchive`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('version', 1);
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('answers the same 404 for a missing and a deleted printer', async () => {
    const { app, repository } = setup();
    const deleted = repository.seed({ deletedAt: archivedAt });

    const missing = await request(app).post(`${BASE}/${MISSING_ID}/unarchive`);
    const gone = await request(app).post(`${BASE}/${deleted.id}/unarchive`);

    expectProblem(missing, 404, 'not_found');
    expectProblem(gone, 404, 'not_found');
    expect(repository.stored.get(deleted.id)).toEqual(deleted);
  });

  it('answers 400 for a malformed id without calling the repository', async () => {
    const { app, repository } = setup();

    const response = await request(app).post(`${BASE}/nope/unarchive`);

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('answers a generic 503 when the database is down', async () => {
    const { app, repository } = setup();
    repository.failWith = new AppError('service_unavailable', 'The printer data is unavailable.');

    expectProblem(
      await request(app).post(`${BASE}/${MISSING_ID}/unarchive`),
      503,
      'service_unavailable',
    );
  });
});

describe('GET /api/v1/printers', () => {
  it('returns an empty first page', async () => {
    const { app } = setup();

    const response = await request(app).get(BASE);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('lists archived printers and counts them, but not deleted ones', async () => {
    const { app, repository } = setup();
    repository.seed({ name: 'Live' });
    repository.seed({ name: 'Archived', archivedAt: new Date('2026-02-01T00:00:00.000Z') });
    repository.seed({ name: 'Deleted', deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    const response = await request(app).get(BASE);

    const items = (response.body as { items: { name: string; archivedAt: string | null }[] }).items;
    expect(items.map((p) => p.name)).toEqual(['Archived', 'Live']);
    expect(items[0]?.archivedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(response.body).toHaveProperty('total', 2);
  });

  it('pages through the results', async () => {
    const { app, repository } = setup();
    for (let n = 1; n <= 5; n += 1) repository.seed({ name: `Printer ${n}` });

    const response = await request(app).get(`${BASE}?page=2&pageSize=2`);

    expect(response.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect((response.body as { items: { name: string }[] }).items.map((p) => p.name)).toEqual([
      'Printer 3',
      'Printer 4',
    ]);
  });

  it('answers 200 with no items and the real total past the last page', async () => {
    const { app, repository } = setup();
    repository.seed();

    const response = await request(app).get(`${BASE}?page=50`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], page: 50, pageSize: 20, total: 1 });
  });

  it('filters by status', async () => {
    const { app, repository } = setup();
    repository.seed({ name: 'A', status: 'maintenance' });
    repository.seed({ name: 'B', status: 'available' });

    const response = await request(app).get(`${BASE}?status=maintenance`);

    expect((response.body as { items: { name: string }[] }).items.map((p) => p.name)).toEqual([
      'A',
    ]);
  });

  it('sorts by name descending', async () => {
    const { app, repository } = setup();
    repository.seed({ name: 'banana' });
    repository.seed({ name: 'Apple' });

    const response = await request(app).get(`${BASE}?sort=name&order=desc`);

    expect((response.body as { items: { name: string }[] }).items.map((p) => p.name)).toEqual([
      'banana',
      'Apple',
    ]);
  });

  it.each([
    'status=broken',
    'status[$ne]=x',
    'status=available&status=in_use',
    'sort=version',
    'sort=deletedAt',
    'sort=$natural',
    'order=up',
    'pageSize=0',
    'pageSize=101',
    'page=0',
    'page=10001',
    'page=abc',
    'unknown=1',
    '$where=1',
    'name[$regex]=.*',
  ])('rejects the query "%s" with 400 without calling the repository', async (query) => {
    const { app, repository } = setup();

    const response = await request(app).get(`${BASE}?${query}`);

    expectProblem(response, 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('exposes no internal field', async () => {
    const { app, repository } = setup();
    repository.seed();

    const response = await request(app).get(BASE);

    const item = (response.body as { items: object[] }).items[0];
    expect(Object.keys(item ?? {}).sort()).toEqual(
      [
        'archivedAt',
        'buildVolume',
        'compatibleMaterials',
        'createdAt',
        'id',
        'name',
        'nozzle',
        'powerWatts',
        'status',
        'typicalSpeedMmS',
        'updatedAt',
        'version',
      ].sort(),
    );
  });
});

describe('GET /api/v1/printers/:id', () => {
  it('returns the printer', async () => {
    const { app, repository } = setup();
    const printer = repository.seed();

    const response = await request(app).get(`${BASE}/${printer.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('id', printer.id);
    expect(response.body).not.toHaveProperty('_id');
    expect(response.body).not.toHaveProperty('__v');
    expect(response.body).not.toHaveProperty('deletedAt');
  });

  it('returns an archived printer with archivedAt', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ archivedAt: new Date('2026-02-01T00:00:00.000Z') });

    const response = await request(app).get(`${BASE}/${printer.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('archivedAt', '2026-02-01T00:00:00.000Z');
  });

  it('answers the same 404 for a missing and a deleted printer', async () => {
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
      const printer = repository.seed();

      const response = await request(app)[method](`${BASE}/${printer.id}`).send({});

      expect([404, 405]).toContain(response.status);
      expect(response.headers['content-type']).toContain('application/problem+json');
    },
  );
});

describe('PATCH /api/v1/printers/:id', () => {
  it('updates the printer and returns the new version', async () => {
    const { app, repository, clock } = setup();
    const printer = repository.seed();
    clock.advanceSeconds(30);

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, name: 'Prusa', status: 'maintenance' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Prusa',
      status: 'maintenance',
      version: 2,
      updatedAt: clock.now().toISOString(),
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('clears the speed with null', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ typicalSpeedMmS: 60, powerWatts: 150 });

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, typicalSpeedMmS: null });

    expect(response.body).toHaveProperty('typicalSpeedMmS', null);
  });

  it('answers 400, not 409, when the version is missing', async () => {
    const { app, repository } = setup();
    const printer = repository.seed();

    const response = await request(app).patch(`${BASE}/${printer.id}`).send({ name: 'Prusa' });

    expectProblem(response, 400, 'validation_failed');
  });

  it('answers 400 for a body with only the version', async () => {
    const { app, repository } = setup();
    const printer = repository.seed();

    const response = await request(app).patch(`${BASE}/${printer.id}`).send({ version: 1 });

    expectProblem(response, 400, 'validation_failed');
  });

  it.each(['archivedAt', 'deletedAt', 'createdAt', '$set', 'nozzle.material'])(
    'rejects %s in the body and leaves the printer untouched',
    async (key) => {
      const { app, repository } = setup();
      const printer = repository.seed();

      const response = await request(app)
        .patch(`${BASE}/${printer.id}`)
        .send({ version: 1, name: 'Prusa', [key]: '2026-01-01T00:00:00.000Z' });

      expectProblem(response, 400, 'validation_failed');
      expect(repository.stored.get(printer.id)).toEqual(printer);
    },
  );

  it('answers 409 with an issue on version when the version is stale', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ version: 4 });

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 3, name: 'Prusa' });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([{ path: 'version', message: expect.any(String) }]);
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('answers 409 with an issue on name for a duplicate name', async () => {
    const { app, repository } = setup();
    repository.seed({ name: 'Taken' });
    const printer = repository.seed({ name: 'Mine' });

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, name: 'TAKEN' });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([{ path: 'name', message: expect.any(String) }]);
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('lets a printer take its own name in a different case', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ name: 'Ender 3' });

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, name: 'ENDER 3' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('name', 'ENDER 3');
  });

  it('answers 400 before 409 when the body is invalid and the version is stale', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ version: 4 });

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, name: '' });

    expectProblem(response, 400, 'validation_failed');
  });

  it('answers 404 before 409 for a missing printer with any version', async () => {
    const { app } = setup();

    const response = await request(app)
      .patch(`${BASE}/${MISSING_ID}`)
      .send({ version: 9, name: 'x' });

    expectProblem(response, 404, 'not_found');
  });

  it('answers 409 for an archived printer', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ archivedAt: new Date('2026-02-01T00:00:00.000Z') });

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, name: 'Prusa' });

    expectProblem(response, 409, 'conflict');
  });

  it('answers 400 on the merged state when the new nozzle breaks the rule', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({
      nozzle: { diameterMm: 0.4, material: 'hardened_steel' },
      compatibleMaterials: ['PA_CF'],
    });

    const response = await request(app)
      .patch(`${BASE}/${printer.id}`)
      .send({ version: 1, nozzle: { diameterMm: 0.4, material: 'brass' } });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([
      { path: 'compatibleMaterials', message: expect.stringContaining('PA_CF') },
    ]);
  });

  it('answers 400 for a malformed id', async () => {
    const { app } = setup();

    const response = await request(app).patch(`${BASE}/nope`).send({ version: 1, name: 'x' });

    expectProblem(response, 400, 'validation_failed');
  });
});

describe('DELETE /api/v1/printers/:id', () => {
  it('answers 204 with no body and then hides the printer', async () => {
    const { app, repository } = setup();
    const printer = repository.seed();

    const response = await request(app).delete(`${BASE}/${printer.id}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect((await request(app).get(`${BASE}/${printer.id}`)).status).toBe(404);
  });

  it('answers 404 when the delete is repeated', async () => {
    const { app, repository } = setup();
    const printer = repository.seed();
    await request(app).delete(`${BASE}/${printer.id}`);

    const again = await request(app).delete(`${BASE}/${printer.id}`);

    expectProblem(again, 404, 'not_found');
  });

  it('archives a printer in use and keeps it visible', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ status: 'in_use' });

    const response = await request(app).delete(`${BASE}/${printer.id}`);
    const after = await request(app).get(`${BASE}/${printer.id}`);

    expect(response.status).toBe(204);
    expect(after.status).toBe(200);
    expect(after.body).toHaveProperty('archivedAt');
    expect((after.body as { archivedAt: string | null }).archivedAt).not.toBeNull();
  });

  it('answers 204 again for a printer that is already archived', async () => {
    const { app, repository } = setup();
    const printer = repository.seed({ archivedAt: new Date('2026-02-01T00:00:00.000Z') });

    const response = await request(app).delete(`${BASE}/${printer.id}`);

    expect(response.status).toBe(204);
  });

  it('archives instead of deleting when the usage check says the printer has assignments', async () => {
    const { app, repository } = setup(() => Promise.resolve(true));
    const printer = repository.seed();

    await request(app).delete(`${BASE}/${printer.id}`);

    expect(repository.stored.get(printer.id)?.archivedAt).not.toBeNull();
    expect(repository.stored.get(printer.id)?.deletedAt).toBeNull();
  });

  it('answers 5xx and changes nothing when the usage check fails', async () => {
    const { app, repository } = setup(() => Promise.reject(new Error('queue host=10.0.0.5 down')));
    const printer = repository.seed();

    const response = await request(app).delete(`${BASE}/${printer.id}`);

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('answers 404 for a missing printer and 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(await request(app).delete(`${BASE}/${MISSING_ID}`), 404, 'not_found');
    expectProblem(await request(app).delete(`${BASE}/not-an-id`), 400, 'validation_failed');
  });
});

describe('dependency failure', () => {
  it('answers a generic 503 problem without driver text', async () => {
    const { app, repository } = setup();
    repository.failWith = new AppError(
      'service_unavailable',
      'The printer data is temporarily unavailable.',
      {
        cause: new Error('MongoServerSelectionError: connect ECONNREFUSED 10.1.2.3:27017'),
      },
    );

    const response = await request(app).get(BASE);

    expectProblem(response, 503, 'service_unavailable');
    expect(JSON.stringify(response.body)).not.toMatch(/Mongo|ECONNREFUSED|10\.1\.2\.3/);
  });

  it('answers a generic 500 problem for an unexpected error', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('E11000 duplicate key collection: print3d.printers index: x');

    const response = await request(app).get(`${BASE}/${MISSING_ID}`);

    expectProblem(response, 500, 'internal');
    expect(JSON.stringify(response.body)).not.toMatch(
      /E11000|duplicate key|print3d\.printers|collection:|index:/,
    );
  });
});
