// Integration test: the whole stack (HTTP, services, repositories) on a real MongoDB replica set.
// Races are asserted by what must hold under ANY interleaving, never by one assumed order.
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp, testConfig } from '../../testing/test-app.js';
import { createTestClock } from './testing/fakes.js';

const BASE = '/api/v1/projects';
const filamentBody = {
  brand: 'Grilon3',
  material: 'PETG',
  colorName: 'Negro',
  initialGrams: 1000,
  purchaseCostMinor: 1_950_000,
  purchaseDate: '2026-02-01',
};
const partBody = {
  name: 'Soporte de estante en L',
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: 5700,
  layerHeightUm: 200,
};

interface ProjectBody {
  id: string;
  name: string;
  version: number;
  items: {
    partId: string;
    filamentId: string | null;
    quantity: number;
    part: { name: string } | null;
    filament: { brand: string; colorName: string } | null;
  }[];
}

describe('projects API on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;
  let partId: string;
  let spoolId: string;
  const clock = createTestClock();
  const projects = () => mongoose.connection.collection('projects');
  const parts = () => mongoose.connection.collection('parts');
  const filaments = () => mongoose.connection.collection('filaments');
  const rawOf = (id: string) => projects().findOne({ _id: new mongoose.Types.ObjectId(id) });

  const create = (overrides: Record<string, unknown> = {}) =>
    request(app)
      .post(BASE)
      .send({ name: 'Soportes para el taller', ...overrides });
  const idOf = (response: request.Response): string => (response.body as ProjectBody).id;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
    app = createTestApp({ database, clock, env: { RATE_LIMIT_MAX: '100000' } });
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await projects().deleteMany({});
    await parts().deleteMany({});
    await filaments().deleteMany({});
    const part = await request(app).post('/api/v1/parts').send(partBody);
    partId = (part.body as { id: string }).id;
    const spool = await request(app).post('/api/v1/filaments').send(filamentBody);
    spoolId = (spool.body as { id: string }).id;
  });

  describe('create and read', () => {
    it('stores the part id as an ObjectId and reads the part data back live', async () => {
      const created = await create({
        items: [{ partId, filamentId: spoolId, quantity: 6 }],
        deadline: '2026-12-24',
      });

      expect(created.status).toBe(201);
      expect((await rawOf(idOf(created)))?.['items']).toEqual([
        {
          partId: new mongoose.Types.ObjectId(partId),
          filamentId: new mongoose.Types.ObjectId(spoolId),
          quantity: 6,
        },
      ]);
      expect((await rawOf(idOf(created)))?.['deadline']).toEqual(
        new Date('2026-12-24T00:00:00.000Z'),
      );
      const read = await request(app).get(`${BASE}/${idOf(created)}`);
      expect(read.body).toMatchObject({
        deadline: '2026-12-24',
        items: [
          {
            partId,
            filamentId: spoolId,
            quantity: 6,
            part: { name: 'Soporte de estante en L', material: 'PETG' },
            filament: {
              brand: 'Grilon3',
              material: 'PETG',
              colorName: 'Negro',
              availableGrams: 1000,
            },
          },
        ],
      });
    });

    it('rejects a part that does not exist and a part that was deleted', async () => {
      await request(app).delete(`/api/v1/parts/${partId}`);

      const deleted = await create({ items: [{ partId, filamentId: spoolId, quantity: 1 }] });
      const unknown = await create({
        items: [{ partId: 'f'.repeat(24), filamentId: spoolId, quantity: 1 }],
      });

      for (const response of [deleted, unknown]) {
        expect(response.status).toBe(400);
        expect(problemSchema.parse(response.body).issues).toEqual([
          { path: 'items.0.partId', message: 'The part does not exist.' },
        ]);
      }
      expect(await projects().countDocuments({})).toBe(0);
    });

    it('rejects a spool that was deleted, and shows filament null on a project that already had it', async () => {
      const created = await create({ items: [{ partId, filamentId: spoolId, quantity: 1 }] });
      await request(app).delete(`/api/v1/filaments/${spoolId}`);

      const gone = await create({ items: [{ partId, filamentId: spoolId, quantity: 1 }] });
      const read = await request(app).get(`${BASE}/${idOf(created)}`);

      expect(gone.status).toBe(400);
      expect(problemSchema.parse(gone.body).issues).toEqual([
        { path: 'items.0.filamentId', message: 'The spool does not exist.' },
      ]);
      expect((read.body as ProjectBody).items).toMatchObject([
        { filamentId: spoolId, filament: null },
      ]);
    });

    it('shows part null in the detail when a line points to a part deleted afterwards', async () => {
      const created = await create({ items: [{ partId, filamentId: spoolId, quantity: 1 }] });
      await parts().updateOne(
        { _id: new mongoose.Types.ObjectId(partId) },
        { $set: { deletedAt: new Date() } },
      );

      const read = await request(app).get(`${BASE}/${idOf(created)}`);

      expect(read.status).toBe(200);
      expect((read.body as ProjectBody).items).toMatchObject([
        { partId, filamentId: spoolId, part: null },
      ]);
    });
  });

  describe('spool on every line (ADR 0036)', () => {
    let otherSpoolId: string;
    beforeEach(async () => {
      const other = await request(app).post('/api/v1/filaments').send(filamentBody);
      otherSpoolId = (other.body as { id: string }).id;
    });

    it('accepts the same part on two different spools', async () => {
      const created = await create({
        items: [
          { partId, filamentId: spoolId, quantity: 2 },
          { partId, filamentId: otherSpoolId, quantity: 3 },
        ],
      });

      expect(created.status).toBe(201);
      expect((created.body as ProjectBody).items.map((item) => item.filamentId)).toEqual([
        spoolId,
        otherSpoolId,
      ]);
    });

    it('rejects the same part and spool twice on the second line', async () => {
      const response = await create({
        items: [
          { partId, filamentId: spoolId, quantity: 2 },
          { partId, filamentId: spoolId, quantity: 3 },
        ],
      });

      expect(response.status).toBe(400);
      expect(problemSchema.parse(response.body).issues?.map((issue) => issue.path)).toEqual([
        'items.1.filamentId',
      ]);
      expect(await projects().countDocuments({})).toBe(0);
    });

    describe('a project stored before spools existed', () => {
      let legacyId: string;
      beforeEach(async () => {
        const now = new Date();
        const inserted = await projects().insertOne({
          name: 'Antiguo',
          description: null,
          priority: 'medium',
          deadline: null,
          items: [{ partId: new mongoose.Types.ObjectId(partId), quantity: 2 }],
          version: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        legacyId = inserted.insertedId.toHexString();
      });

      it('opens with filamentId null, refuses to save a null spool and accepts a real one', async () => {
        const url = `${BASE}/${legacyId}`;

        const read = await request(app).get(url);
        const withNull = await request(app)
          .patch(url)
          .send({ version: 1, items: [{ partId, filamentId: null, quantity: 2 }] });
        const withSpool = await request(app)
          .patch(url)
          .send({ version: 1, items: [{ partId, filamentId: spoolId, quantity: 2 }] });

        expect(read.status).toBe(200);
        expect((read.body as ProjectBody).items).toMatchObject([{ partId, filamentId: null }]);
        expect(withNull.status).toBe(400);
        expect(problemSchema.parse(withNull.body).issues?.map((issue) => issue.path)).toEqual([
          'items.0.filamentId',
        ]);
        expect(withSpool.status).toBe(200);
        expect((withSpool.body as ProjectBody).items).toMatchObject([{ filamentId: spoolId }]);
      });
    });
  });

  describe('version races', () => {
    it('lets one of two edits with the same version win and answers 409 to the other', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const [first, second] = await Promise.all([
        request(app).patch(url).send({ version: 1, name: 'Uno' }),
        request(app).patch(url).send({ version: 1, name: 'Dos' }),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(problemSchema.parse(loser.body).issues?.[0]?.path).toBe('version');
      const raw = await rawOf(idOf(created));
      expect(raw?.['version']).toBe(2);
      expect(['Uno', 'Dos']).toContain(raw?.['name']);
    });

    it('never answers 500 and never modifies a deleted project when an edit and a delete race', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create({ name: `Race ${String(round)}` });
        const url = `${BASE}/${idOf(created)}`;

        const [edit, removal] = await Promise.all([
          request(app).patch(url).send({ version: 1, name: 'Edited' }),
          request(app).delete(url),
        ]);

        expect(removal.status).toBe(204);
        expect([200, 404]).toContain(edit.status);
        const raw = await rawOf(idOf(created));
        expect(raw?.['deletedAt']).toBeInstanceOf(Date);
        expect(raw?.['version']).toBe(edit.status === 200 ? 3 : 2);
        expect((await request(app).get(url)).status).toBe(404);
      }
    });

    it('answers 204 to one of two simultaneous deletes and 404 to the other', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const [first, second] = await Promise.all([
        request(app).delete(url),
        request(app).delete(url),
      ]);

      expect([first.status, second.status].sort()).toEqual([204, 404]);
      expect(await rawOf(idOf(created))).toMatchObject({ version: 2 });
    });
  });

  describe('list', () => {
    it('sorts by priority and keeps undated projects last, through HTTP', async () => {
      await create({ name: 'U', priority: 'urgent', deadline: '2026-01-01' });
      await create({ name: 'L', priority: 'low' });
      await create({ name: 'H', priority: 'high', deadline: '2027-01-01' });

      const byPriority = await request(app).get(`${BASE}?sort=priority&order=asc`);
      const byDeadline = await request(app).get(`${BASE}?sort=deadline&order=desc`);

      const names = (response: request.Response) =>
        (response.body as { items: { name: string }[] }).items.map((item) => item.name);
      expect(names(byPriority)).toEqual(['L', 'H', 'U']);
      expect(names(byDeadline)).toEqual(['H', 'U', 'L']);
    });

    it('answers summaries with itemCount and unitCount', async () => {
      await create({ items: [{ partId, filamentId: spoolId, quantity: 6 }] });

      const response = await request(app).get(BASE);

      expect((response.body as { items: unknown[] }).items[0]).toMatchObject({
        itemCount: 1,
        unitCount: 6,
      });
    });
  });
});
