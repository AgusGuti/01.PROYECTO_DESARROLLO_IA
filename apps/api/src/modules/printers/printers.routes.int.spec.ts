// Integration test: the whole stack (HTTP, service, repository) on a real MongoDB replica set.
// It proves the behaviour that only real indexes and atomic updates can give: races, name
// reservation, collation and the archive path.
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp, testConfig } from '../../testing/test-app.js';
import { createMongoPrinterRepository } from './printers.repository.js';
import { createTestClock } from './testing/fakes.js';

const BASE = '/api/v1/printers';
const body = {
  name: 'Ender 3',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.4, material: 'brass' },
  compatibleMaterials: ['PLA', 'PETG'],
};

interface PrinterBody {
  id: string;
  name: string;
  version: number;
  archivedAt: string | null;
  status: string;
}

describe('printers API on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;
  let archivingApp: Express;
  let failingUsageApp: Express;
  const collection = () => mongoose.connection.collection('printers');

  const build = (hasAssignments?: () => Promise<boolean>): Express =>
    createTestApp({
      database,
      clock: createTestClock(),
      env: { RATE_LIMIT_MAX: '100000' },
      printers: hasAssignments === undefined ? {} : { hasAssignments },
    });

  const create = (overrides: Record<string, unknown> = {}, target: Express = app) =>
    request(target)
      .post(BASE)
      .send({ ...body, ...overrides });

  const idOf = (response: request.Response): string => (response.body as PrinterBody).id;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
    await createMongoPrinterRepository().ensureIndexes();
    app = build();
    archivingApp = build(() => Promise.resolve(true));
    failingUsageApp = build(() => Promise.reject(new Error('queue at 10.9.9.9 is down')));
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await collection().deleteMany({});
  });

  describe('name uniqueness', () => {
    it.each([
      ['a different case', 'ENDER 3'],
      ['all lowercase', 'ender 3'],
      ['surrounding spaces', '  Ender 3  '],
    ])('answers 409 on name for a duplicate with %s', async (_label, other) => {
      await create();

      const response = await create({ name: other });

      expect(response.status).toBe(409);
      expect(problemSchema.parse(response.body).issues).toEqual([
        { path: 'name', message: expect.any(String) },
      ]);
      expect(await collection().countDocuments({})).toBe(1);
    });

    it('treats composed and decomposed accents as the same name', async () => {
      await create({ name: 'Café' });

      const response = await create({ name: 'Café' });

      expect(response.status).toBe(409);
    });

    it('lets exactly one of two simultaneous creates win, twenty times over', async () => {
      for (let round = 0; round < 20; round += 1) {
        const name = `Race ${round}`;

        const [first, second] = await Promise.all([create({ name }), create({ name })]);

        expect([first.status, second.status].sort()).toEqual([201, 409]);
        expect(await collection().countDocuments({ name })).toBe(1);
      }
    });

    it('lets a printer be renamed to its own name in a different case', async () => {
      const created = await create();

      const response = await request(app)
        .patch(`${BASE}/${idOf(created)}`)
        .send({ version: 1, name: 'ENDER 3' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ name: 'ENDER 3', version: 2 });
    });

    it('answers 409 on name when renaming onto another printer, and leaves the version alone', async () => {
      await create({ name: 'Taken' });
      const mine = await create({ name: 'Mine' });

      const response = await request(app)
        .patch(`${BASE}/${idOf(mine)}`)
        .send({ version: 1, name: 'taken' });

      expect(response.status).toBe(409);
      expect(problemSchema.parse(response.body).issues?.[0]?.path).toBe('name');
      expect((await request(app).get(`${BASE}/${idOf(mine)}`)).body).toEqual(mine.body);
    });
  });

  describe('optimistic concurrency', () => {
    it('lets exactly one of two simultaneous edits with the same version win', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const [first, second] = await Promise.all([
        request(app).patch(url).send({ version: 1, name: 'First' }),
        request(app).patch(url).send({ version: 1, name: 'Second' }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      const winner = first.status === 200 ? first : second;
      expect(problemSchema.parse(loser.body).issues?.[0]?.path).toBe('version');
      const final = (await request(app).get(url)).body as PrinterBody;
      expect(final).toMatchObject({ version: 2, name: (winner.body as PrinterBody).name });
    });

    it('answers 409 on version for a stale edit and changes nothing', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;
      await request(app).patch(url).send({ version: 1, status: 'maintenance' });

      const stale = await request(app).patch(url).send({ version: 1, name: 'Late' });

      expect(stale.status).toBe(409);
      expect(problemSchema.parse(stale.body).issues?.[0]?.path).toBe('version');
      expect((await request(app).get(url)).body).toMatchObject({
        name: 'Ender 3',
        status: 'maintenance',
        version: 2,
      });
    });

    it('does not bump the version or updatedAt on a failed domain check', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(app)
        .patch(url)
        .send({ version: 1, compatibleMaterials: ['PA_CF'] });

      expect(response.status).toBe(400);
      expect((await request(app).get(url)).body).toEqual(created.body);
    });

    it('clears and then restores the speed', async () => {
      const created = await create({ typicalSpeedMmS: 60 });
      const url = `${BASE}/${idOf(created)}`;

      const cleared = await request(app).patch(url).send({ version: 1, typicalSpeedMmS: null });
      const restored = await request(app).patch(url).send({ version: 2, typicalSpeedMmS: 90 });

      expect(cleared.body).toHaveProperty('typicalSpeedMmS', null);
      expect(restored.body).toHaveProperty('typicalSpeedMmS', 90);
    });

    it('never answers 500 and never modifies a deleted printer when an edit and a delete race', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create({ name: `Race ${round}` });
        const url = `${BASE}/${idOf(created)}`;

        const [edit, removal] = await Promise.all([
          request(app)
            .patch(url)
            .send({ version: 1, name: `Renamed ${round}` }),
          request(app).delete(url),
        ]);

        expect(removal.status).toBe(204);
        expect([200, 404, 409]).toContain(edit.status);
        const raw = await collection().findOne({ _id: new mongoose.Types.ObjectId(idOf(created)) });
        expect(raw?.['deletedAt']).toBeInstanceOf(Date);
        expect((await request(app).get(url)).status).toBe(404);
      }
    });
  });

  describe('delete', () => {
    it('removes an idle printer logically: 404 afterwards, document kept with deletedAt', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(app).delete(url);

      expect(response.status).toBe(204);
      expect((await request(app).get(url)).status).toBe(404);
      const raw = await collection().findOne({ _id: new mongoose.Types.ObjectId(idOf(created)) });
      expect(raw?.['deletedAt']).toBeInstanceOf(Date);
    });

    it('answers 204 for one of two simultaneous deletes and 404 for the other', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const [first, second] = await Promise.all([
        request(app).delete(url),
        request(app).delete(url),
      ]);

      expect([first.status, second.status].sort()).toEqual([204, 404]);
      expect(await collection().countDocuments({ deletedAt: { $ne: null } })).toBe(1);
    });

    it('answers 404 when the delete is repeated', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;
      await request(app).delete(url);

      expect((await request(app).delete(url)).status).toBe(404);
    });

    it('keeps the name of a deleted printer reserved: 409 on restoreIfDeleted, no new document', async () => {
      const first = await create();
      await request(app).delete(`${BASE}/${idOf(first)}`);

      const second = await create({ name: 'ender 3' });

      expect(second.status).toBe(409);
      expect(problemSchema.parse(second.body).issues).toEqual([
        { path: 'restoreIfDeleted', message: expect.any(String) },
      ]);
      expect(JSON.stringify(second.body)).not.toContain(idOf(first));
      expect(await collection().countDocuments({})).toBe(1);
    });

    it('archives a printer in use instead of removing it', async () => {
      const created = await create({ status: 'in_use' });
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(app).delete(url);

      expect(response.status).toBe(204);
      const after = await request(app).get(url);
      expect(after.status).toBe(200);
      expect((after.body as PrinterBody).archivedAt).toEqual(expect.any(String));
    });

    describe('when the printer has assignments (usage check answers true)', () => {
      it('archives it: visible with archivedAt, 409 on edit, 204 on a repeated delete', async () => {
        const created = await create({}, archivingApp);
        const url = `${BASE}/${idOf(created)}`;

        const removal = await request(archivingApp).delete(url);
        const read = await request(archivingApp).get(url);
        const edit = await request(archivingApp).patch(url).send({ version: 2, name: 'New' });
        const again = await request(archivingApp).delete(url);

        expect(removal.status).toBe(204);
        expect(read.status).toBe(200);
        expect((read.body as PrinterBody).archivedAt).toEqual(expect.any(String));
        expect(edit.status).toBe(409);
        expect(again.status).toBe(204);
        const raw = await collection().findOne({ _id: new mongoose.Types.ObjectId(idOf(created)) });
        expect(raw).toHaveProperty('deletedAt', null);
        expect(raw).toMatchObject({ version: 2 });
      });

      it('keeps the name reserved, and still lists and counts the printer', async () => {
        const created = await create({}, archivingApp);
        await request(archivingApp).delete(`${BASE}/${idOf(created)}`);

        const duplicate = await create({ name: 'ENDER 3' }, archivingApp);
        const list = await request(archivingApp).get(BASE);

        expect(duplicate.status).toBe(409);
        expect(list.body).toMatchObject({ total: 1 });
        expect((list.body as { items: PrinterBody[] }).items[0]?.archivedAt).toEqual(
          expect.any(String),
        );
      });
    });

    it('answers 5xx and leaves the printer unchanged when the usage check fails', async () => {
      const created = await create({}, failingUsageApp);
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(failingUsageApp).delete(url);

      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(response.body)).not.toContain('10.9.9.9');
      expect((await request(app).get(url)).body).toEqual(created.body);
    });
  });

  describe('restoring a deleted printer through POST', () => {
    const deleteAndRecreate = async (overrides: Record<string, unknown> = {}) => {
      const first = await create({ typicalSpeedMmS: 80 });
      await request(app).delete(`${BASE}/${idOf(first)}`);
      return { first, response: await create({ restoreIfDeleted: true, ...overrides }) };
    };

    it('answers 200 with the submitted data and bumps the version, keeping one document', async () => {
      const { first, response } = await deleteAndRecreate({
        name: 'ENDER 3',
        status: 'maintenance',
        compatibleMaterials: ['ABS'],
      });

      expect(response.status).toBe(200);
      expect(response.headers['location']).toBe(`${BASE}/${idOf(first)}`);
      expect(response.body).toEqual({
        ...(first.body as object),
        name: 'ENDER 3',
        status: 'maintenance',
        compatibleMaterials: ['ABS'],
        typicalSpeedMmS: null,
        version: 3,
        updatedAt: expect.any(String),
      });
      const raw = await collection().findOne({});
      expect(raw).toMatchObject({ deletedAt: null, archivedAt: null, version: 3 });
      expect(await collection().countDocuments({})).toBe(1);
    });

    it('shows the restored printer in the list and by id', async () => {
      const { first } = await deleteAndRecreate();

      const list = await request(app).get(BASE);
      const read = await request(app).get(`${BASE}/${idOf(first)}`);

      expect((list.body as { items: PrinterBody[] }).items.map((item) => item.id)).toEqual([
        idOf(first),
      ]);
      expect(list.body).toMatchObject({ total: 1 });
      expect(read.status).toBe(200);
    });

    it('restores a name that differs only in case or accent composition', async () => {
      const first = await create({ name: 'Café' });
      await request(app).delete(`${BASE}/${idOf(first)}`);

      const response = await create({ name: 'CAFÉ', restoreIfDeleted: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: idOf(first), name: 'CAFÉ' });
    });

    it('creates normally with 201 when the flag is true and no deleted printer matches', async () => {
      const response = await create({ restoreIfDeleted: true });

      expect(response.status).toBe(201);
      expect(await collection().countDocuments({})).toBe(1);
    });

    it('answers 409 on name when a live printer holds the name, even with the flag', async () => {
      await create();

      const response = await create({ restoreIfDeleted: true });

      expect(response.status).toBe(409);
      expect(problemSchema.parse(response.body).issues?.[0]?.path).toBe('name');
    });

    it('answers 409 on name when an archived printer holds the name', async () => {
      const created = await create({}, archivingApp);
      await request(archivingApp).delete(`${BASE}/${idOf(created)}`);

      const plain = await create({}, archivingApp);
      const flagged = await create({ restoreIfDeleted: true }, archivingApp);

      for (const response of [plain, flagged]) {
        expect(response.status).toBe(409);
        expect(problemSchema.parse(response.body).issues?.[0]?.path).toBe('name');
      }
    });

    it('answers 400 for a reinforced material on a brass nozzle and leaves the deleted document unchanged', async () => {
      const first = await create();
      await request(app).delete(`${BASE}/${idOf(first)}`);
      const before = await collection().findOne({});

      const response = await create({ compatibleMaterials: ['PA_CF'], restoreIfDeleted: true });

      expect(response.status).toBe(400);
      expect(await collection().findOne({})).toEqual(before);
    });

    it('lets exactly one of two simultaneous restores win and answers 409 on name to the other', async () => {
      for (let round = 0; round < 10; round += 1) {
        const name = `Race ${round}`;
        const first = await create({ name });
        await request(app).delete(`${BASE}/${idOf(first)}`);

        const [a, b] = await Promise.all([
          create({ name, restoreIfDeleted: true }),
          create({ name, restoreIfDeleted: true }),
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 409]);
        const loser = a.status === 409 ? a : b;
        expect(problemSchema.parse(loser.body).issues?.[0]?.path).toBe('name');
        expect(await collection().countDocuments({ name })).toBe(1);
      }
    });
  });

  describe('unarchive', () => {
    const archive = async () => {
      const created = await create({}, archivingApp);
      const url = `${BASE}/${idOf(created)}`;
      await request(archivingApp).delete(url);
      return { created, url };
    };

    it('answers 200, then PATCH works and DELETE removes the idle printer', async () => {
      const { url } = await archive();

      const unarchived = await request(app).post(`${url}/unarchive`);
      const edit = await request(app).patch(url).send({ version: 3, name: 'Prusa' });
      const removal = await request(app).delete(url);

      expect(unarchived.status).toBe(200);
      expect(unarchived.body).toMatchObject({ archivedAt: null, version: 3 });
      expect(edit.status).toBe(200);
      expect(removal.status).toBe(204);
      expect((await request(app).get(url)).status).toBe(404);
    });

    it('answers 200 again without changing the version', async () => {
      const { url } = await archive();
      await request(app).post(`${url}/unarchive`);

      const again = await request(app).post(`${url}/unarchive`);

      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ archivedAt: null, version: 3 });
    });

    it('answers 404 for a deleted printer and leaves it untouched', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;
      await request(app).delete(url);
      const before = await collection().findOne({});

      const response = await request(app).post(`${url}/unarchive`);

      expect(response.status).toBe(404);
      expect(await collection().findOne({})).toEqual(before);
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      expect((await request(app).post(`${BASE}/${'0'.repeat(24)}/unarchive`)).status).toBe(404);
      expect((await request(app).post(`${BASE}/nope/unarchive`)).status).toBe(400);
    });

    it('never answers 500 and never modifies a deleted printer when unarchive races delete', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create({ name: `Race ${round}` }, archivingApp);
        const url = `${BASE}/${idOf(created)}`;
        await request(archivingApp).delete(url);

        const [unarchived, removal] = await Promise.all([
          request(archivingApp).post(`${url}/unarchive`),
          // This app has assignments, so the delete archives; against an archived printer it is a no-op.
          request(app).delete(url),
        ]);

        expect(unarchived.status).toBe(200);
        expect([204, 404]).toContain(removal.status);
        const raw = await collection().findOne({ _id: new mongoose.Types.ObjectId(idOf(created)) });
        if (raw?.['deletedAt'] !== null) {
          // Only a delete that ran after the unarchive may have removed it.
          expect(removal.status).toBe(204);
        }
      }
    });
  });

  describe('list', () => {
    it('pages 25 printers as 10, 10 and 5 with a total of 25', async () => {
      for (let n = 1; n <= 25; n += 1) {
        await create({ name: `Printer ${String(n).padStart(2, '0')}` });
      }

      const pages = await Promise.all(
        [1, 2, 3].map((page) => request(app).get(`${BASE}?page=${page}&pageSize=10`)),
      );

      const bodies = pages.map((page) => page.body as { items: PrinterBody[]; total: number });
      expect(bodies.map((page) => page.items.length)).toEqual([10, 10, 5]);
      expect(bodies.map((page) => page.total)).toEqual([25, 25, 25]);
      const names = bodies.flatMap((page) => page.items.map((item) => item.name));
      expect(new Set(names).size).toBe(25);
    });

    it('sorts by name without regard to case', async () => {
      await create({ name: 'banana' });
      await create({ name: 'Apple' });
      await create({ name: 'cherry' });

      const response = await request(app).get(`${BASE}?sort=name&order=asc`);

      expect((response.body as { items: PrinterBody[] }).items.map((item) => item.name)).toEqual([
        'Apple',
        'banana',
        'cherry',
      ]);
    });

    it('answers 200 with no items and the real total past the last page', async () => {
      await create();

      const response = await request(app).get(`${BASE}?page=100`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: [], page: 100, pageSize: 20, total: 1 });
    });

    it('filters by status and hides deleted printers', async () => {
      await create({ name: 'A', status: 'maintenance' });
      const gone = await create({ name: 'B', status: 'maintenance' });
      await create({ name: 'C' });
      await request(app).delete(`${BASE}/${idOf(gone)}`);

      const response = await request(app).get(`${BASE}?status=maintenance`);

      expect((response.body as { items: PrinterBody[] }).items.map((item) => item.name)).toEqual([
        'A',
      ]);
      expect(response.body).toMatchObject({ total: 1 });
    });
  });

  describe('responses', () => {
    it('never exposes internal fields', async () => {
      const created = await create();

      const read = await request(app).get(`${BASE}/${idOf(created)}`);

      for (const response of [created, read]) {
        expect(response.body).not.toHaveProperty('_id');
        expect(response.body).not.toHaveProperty('__v');
        expect(response.body).not.toHaveProperty('deletedAt');
      }
      expect(Object.keys(read.body as object).sort()).toEqual(
        Object.keys(created.body as object).sort(),
      );
    });
  });

  // Keep last: it closes the connection for the rest of this file.
  describe('when MongoDB is unreachable', () => {
    it('answers a generic problem without driver text', async () => {
      await database.disconnect();

      const response = await request(app).get(BASE);

      expect(response.status).toBe(503);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(problemSchema.parse(response.body).code).toBe('service_unavailable');
      expect(JSON.stringify(response.body)).not.toMatch(
        /mongo|buffer|127\.0\.0\.1|localhost|printers\b.*\bfind/i,
      );
    });
  });
});
