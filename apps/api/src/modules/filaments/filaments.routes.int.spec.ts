// Integration test: the whole stack (HTTP, service, repository) on a real MongoDB replica set.
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

const BASE = '/api/v1/filaments';
const body = {
  brand: 'Grilon3',
  material: 'PLA',
  colorName: 'Negro',
  initialGrams: 1000,
  purchaseCostMinor: 1_950_000,
  purchaseDate: '2026-02-17',
};

interface FilamentBody {
  id: string;
  brand: string;
  availableGrams: number;
  purchaseDate: string;
  version: number;
  updatedAt: string;
}

describe('filaments API on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;
  const clock = createTestClock();
  const collection = () => mongoose.connection.collection('filaments');
  const rawOf = (id: string) => collection().findOne({ _id: new mongoose.Types.ObjectId(id) });

  const create = (overrides: Record<string, unknown> = {}) =>
    request(app)
      .post(BASE)
      .send({ ...body, ...overrides });
  const idOf = (response: request.Response): string => (response.body as FilamentBody).id;
  const consume = (id: string, grams: number) =>
    request(app).post(`${BASE}/${id}/consume`).send({ grams });

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
    await collection().deleteMany({});
  });

  describe('purchaseDate', () => {
    it('is stored as UTC midnight and returned as YYYY-MM-DD', async () => {
      const created = await create();

      const read = await request(app).get(`${BASE}/${idOf(created)}`);

      expect(created.body).toHaveProperty('purchaseDate', '2026-02-17');
      expect(read.body).toHaveProperty('purchaseDate', '2026-02-17');
      expect((await rawOf(idOf(created)))?.['purchaseDate']).toEqual(
        new Date('2026-02-17T00:00:00.000Z'),
      );
    });
  });

  describe('create', () => {
    it('answers 201 twice for identical spools', async () => {
      const [first, second] = [await create(), await create()];

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(await collection().countDocuments({})).toBe(2);
    });
  });

  describe('optimistic concurrency', () => {
    it('lets exactly one of two simultaneous edits with the same version win', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const [first, second] = await Promise.all([
        request(app).patch(url).send({ version: 1, colorName: 'First' }),
        request(app).patch(url).send({ version: 1, colorName: 'Second' }),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      const winner = first.status === 200 ? first : second;
      expect(problemSchema.parse(loser.body).issues?.[0]?.path).toBe('version');
      expect((await request(app).get(url)).body).toMatchObject({
        version: 2,
        colorName: (winner.body as { colorName: string }).colorName,
      });
    });

    it('does not bump the version on a failed schema or domain check', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(app).patch(url).send({ version: 1, initialGrams: 0 });
      const rule = await request(app).patch(url).send({ version: 1, purchaseDate: '2026-03-02' });

      expect([response.status, rule.status]).toEqual([400, 400]);
      expect((await request(app).get(url)).body).toEqual(created.body);
    });

    it('answers 409 on version for a PATCH made stale by a consume, then works on the new version', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;
      await consume(idOf(created), 100);

      const stale = await request(app).patch(url).send({ version: 1, colorName: 'Rojo' });
      const fresh = await request(app).patch(url).send({ version: 2, colorName: 'Rojo' });

      expect(stale.status).toBe(409);
      expect(problemSchema.parse(stale.body).issues?.[0]?.path).toBe('version');
      expect(fresh.status).toBe(200);
      expect(fresh.body).toMatchObject({ colorName: 'Rojo', availableGrams: 900, version: 3 });
    });

    it('keeps both effects or rejects the edit when an edit and a consume race on the same version', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create({ brand: `Race ${String(round)}` });
        const url = `${BASE}/${idOf(created)}`;

        const [edit, taken] = await Promise.all([
          request(app).patch(url).send({ version: 1, colorName: 'Rojo' }),
          consume(idOf(created), 100),
        ]);

        // The consume never conflicts. The edit either ran first (200, then the consume adds a
        // second bump) or lost the version race (409): both orders are valid.
        expect(taken.status).toBe(200);
        expect([200, 409]).toContain(edit.status);
        const final = (await request(app).get(url)).body as FilamentBody;
        expect(final).toMatchObject({ availableGrams: 900 });
        expect(final).toMatchObject(
          edit.status === 200 ? { version: 3, colorName: 'Rojo' } : { version: 2 },
        );
      }
    });

    it('lets four consumes that fit exactly all succeed and leave nothing', async () => {
      const created = await create({ initialGrams: 100, availableGrams: 100 });

      const responses = await Promise.all(
        Array.from({ length: 4 }, () => consume(idOf(created), 25)),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      const final = (await request(app).get(`${BASE}/${idOf(created)}`)).body as FilamentBody;
      expect(final).toMatchObject({ availableGrams: 0, version: 5 });
    });

    it('never answers 500 and never modifies a deleted spool when an edit and a delete race', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create({ brand: `Race ${String(round)}` });
        const url = `${BASE}/${idOf(created)}`;

        const [edit, removal] = await Promise.all([
          request(app).patch(url).send({ version: 1, colorName: 'Edited' }),
          request(app).delete(url),
        ]);

        // The delete always wins eventually; the edit either ran fully before it or found nothing.
        expect(removal.status).toBe(204);
        expect([200, 404]).toContain(edit.status);
        const raw = await rawOf(idOf(created));
        expect(raw?.['deletedAt']).toBeInstanceOf(Date);
        expect(raw?.['version']).toBe(edit.status === 200 ? 3 : 2);
        expect((await request(app).get(url)).status).toBe(404);
      }
    });
  });

  describe('delete', () => {
    it('removes logically: 404 afterwards, document kept with deletedAt', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(app).delete(url);

      expect(response.status).toBe(204);
      expect((await request(app).get(url)).status).toBe(404);
      expect((await rawOf(idOf(created)))?.['deletedAt']).toBeInstanceOf(Date);
    });

    it('answers 204 for one of two simultaneous deletes and 404 for the other', async () => {
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

  describe('consume', () => {
    it('takes 120 from 500: 380 left, version +1, updatedAt from the clock', async () => {
      const created = await create({ initialGrams: 1000, availableGrams: 500 });
      clock.advanceSeconds(60);

      const response = await consume(idOf(created), 120);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ...(created.body as object),
        availableGrams: 380,
        version: 2,
        updatedAt: clock.now().toISOString(),
      });
    });

    it('takes exactly what is left: 200 with 0, and inStock=false lists it', async () => {
      const created = await create({ initialGrams: 200, availableGrams: 200 });

      const response = await consume(idOf(created), 200);
      const empty = await request(app).get(`${BASE}?inStock=false`);
      const full = await request(app).get(`${BASE}?inStock=true`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('availableGrams', 0);
      expect((empty.body as { items: FilamentBody[] }).items.map((item) => item.id)).toEqual([
        idOf(created),
      ]);
      expect((full.body as { total: number }).total).toBe(0);
    });

    it('answers 409 on grams for one gram too many and leaves the document unchanged', async () => {
      const created = await create({ initialGrams: 200, availableGrams: 200 });
      const before = await rawOf(idOf(created));

      const response = await consume(idOf(created), 201);

      expect(response.status).toBe(409);
      expect(problemSchema.parse(response.body).issues).toEqual([
        { path: 'grams', message: 'Not enough material available.' },
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(/availableGrams|\b200\b|\b201\b/);
      expect(await rawOf(idOf(created))).toEqual(before);
    });

    it('answers 404 for a missing and for a deleted spool', async () => {
      const created = await create();
      await request(app).delete(`${BASE}/${idOf(created)}`);
      const before = await rawOf(idOf(created));

      expect((await consume('0'.repeat(24), 1)).status).toBe(404);
      expect((await consume(idOf(created), 1)).status).toBe(404);
      expect(await rawOf(idOf(created))).toEqual(before);
    });

    it('lets exactly 3 of 5 parallel consumes of 30 succeed from a stock of 100', async () => {
      const created = await create({ initialGrams: 100, availableGrams: 100 });

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => consume(idOf(created), 30)),
      );

      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([200, 200, 200, 409, 409]);
      expect(await rawOf(idOf(created))).toMatchObject({ availableGrams: 10, version: 4 });
    });

    it('never goes below zero with 20 parallel consumes of 1 from a stock of 7', async () => {
      const created = await create({ initialGrams: 7, availableGrams: 7 });

      const responses = await Promise.all(
        Array.from({ length: 20 }, () => consume(idOf(created), 1)),
      );

      expect(responses.filter((response) => response.status === 200)).toHaveLength(7);
      expect(responses.filter((response) => response.status === 409)).toHaveLength(13);
      expect(await rawOf(idOf(created))).toMatchObject({ availableGrams: 0, version: 8 });
    });

    it('never answers 500 and never modifies a deleted spool when a consume races a delete', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create({ initialGrams: 100, availableGrams: 100 });

        const [taken, removal] = await Promise.all([
          consume(idOf(created), 10),
          request(app).delete(`${BASE}/${idOf(created)}`),
        ]);

        expect(removal.status).toBe(204);
        expect([200, 404]).toContain(taken.status);
        // Whichever ran first, the final document is consistent with what each call was told.
        expect(await rawOf(idOf(created))).toMatchObject(
          taken.status === 200
            ? { availableGrams: 90, version: 3 }
            : { availableGrams: 100, version: 2 },
        );
      }
    });
  });

  describe('list', () => {
    it('pages 25 spools as 10, 10 and 5 with no repeats', async () => {
      for (let n = 0; n < 25; n += 1) await create();

      const pages = await Promise.all(
        [1, 2, 3].map((page) => request(app).get(`${BASE}?page=${String(page)}&pageSize=10`)),
      );

      const bodies = pages.map((page) => page.body as { items: FilamentBody[]; total: number });
      expect(bodies.map((page) => page.items.length)).toEqual([10, 10, 5]);
      expect(bodies.map((page) => page.total)).toEqual([25, 25, 25]);
      const ids = bodies.flatMap((page) => page.items.map((item) => item.id));
      expect(new Set(ids).size).toBe(25);
    });

    it('sorts the brand without regard to case', async () => {
      await create({ brand: 'banana' });
      await create({ brand: 'Apple' });
      await create({ brand: 'cherry' });

      const response = await request(app).get(`${BASE}?sort=brand&order=asc`);

      expect((response.body as { items: FilamentBody[] }).items.map((item) => item.brand)).toEqual([
        'Apple',
        'banana',
        'cherry',
      ]);
    });

    it('answers 200 with no items and the real total past the last page', async () => {
      await create();

      const response = await request(app).get(`${BASE}?page=100`);

      expect(response.body).toEqual({ items: [], page: 100, pageSize: 20, total: 1 });
    });

    it('hides deleted spools from the list and the total', async () => {
      const gone = await create({ brand: 'Gone' });
      await create({ brand: 'Live' });
      await request(app).delete(`${BASE}/${idOf(gone)}`);

      const response = await request(app).get(BASE);

      expect((response.body as { items: FilamentBody[] }).items.map((item) => item.brand)).toEqual([
        'Live',
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
        /mongo|buffer|127\.0\.0\.1|localhost|filaments\b.*\bfind/i,
      );
    });
  });
});
