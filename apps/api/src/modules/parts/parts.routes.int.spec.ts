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

const BASE = '/api/v1/parts';
const body = {
  name: 'Soporte de estante en L',
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: 5700,
  layerHeightUm: 200,
};
const gcodeSource = { kind: 'gcode', fileName: 'florero-espiral.gcode', slicer: 'cura' };

interface PartBody {
  id: string;
  name: string;
  version: number;
  source: { kind: string; analyzedAt?: string };
}

describe('parts API on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;
  const clock = createTestClock();
  const collection = () => mongoose.connection.collection('parts');
  const rawOf = (id: string) => collection().findOne({ _id: new mongoose.Types.ObjectId(id) });

  const create = (overrides: Record<string, unknown> = {}) =>
    request(app)
      .post(BASE)
      .send({ ...body, ...overrides });
  const idOf = (response: request.Response): string => (response.body as PartBody).id;

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

  describe('create', () => {
    it('answers 201 twice for two parts with the same name', async () => {
      const [first, second] = [await create(), await create()];

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(await collection().countDocuments({})).toBe(2);
    });

    it('stamps analyzedAt from the server clock and stores it as a Date', async () => {
      clock.advanceSeconds(120);

      const created = await create({ source: gcodeSource });

      expect(created.body).toMatchObject({
        source: { ...gcodeSource, analyzedAt: clock.now().toISOString() },
      });
      expect(
        ((await rawOf(idOf(created)))?.['source'] as { analyzedAt: unknown }).analyzedAt,
      ).toEqual(clock.now());
    });

    it('rejects a client analyzedAt and stores nothing', async () => {
      const response = await create({
        source: { ...gcodeSource, analyzedAt: '2000-01-01T00:00:00.000Z' },
      });

      expect(response.status).toBe(400);
      expect(await collection().countDocuments({})).toBe(0);
    });

    it('creates no secondary index: only _id_ exists', async () => {
      await create();

      const indexes = await collection().listIndexes().toArray();

      expect(indexes.map((index): unknown => index.name)).toEqual(['_id_']);
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

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      const winner = first.status === 200 ? first : second;
      expect(problemSchema.parse(loser.body).issues?.[0]?.path).toBe('version');
      expect((await request(app).get(url)).body).toMatchObject({
        version: 2,
        name: (winner.body as PartBody).name,
      });
    });

    it('does not bump the version on a failed schema check', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(app).patch(url).send({ version: 1, estimatedWeightGrams: 0 });

      expect(response.status).toBe(400);
      expect((await request(app).get(url)).body).toEqual(created.body);
    });

    it('answers 409 on version for a stale PATCH, then works on the new version', async () => {
      const created = await create();
      const url = `${BASE}/${idOf(created)}`;
      await request(app).patch(url).send({ version: 1, name: 'Uno' });

      const stale = await request(app).patch(url).send({ version: 1, name: 'Dos' });
      const fresh = await request(app).patch(url).send({ version: 2, name: 'Dos' });

      expect(stale.status).toBe(409);
      expect(problemSchema.parse(stale.body).issues?.[0]?.path).toBe('version');
      expect(fresh.body).toMatchObject({ name: 'Dos', version: 3 });
    });

    it('never answers 500 and never modifies a deleted part when an edit and a delete race', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await create({ name: `Race ${String(round)}` });
        const url = `${BASE}/${idOf(created)}`;

        const [edit, removal] = await Promise.all([
          request(app).patch(url).send({ version: 1, name: 'Edited' }),
          request(app).delete(url),
        ]);

        // The delete always wins eventually; the edit either ran fully before it or found nothing.
        expect(removal.status).toBe(204);
        expect([200, 404]).toContain(edit.status);
        const raw = await rawOf(idOf(created));
        expect(raw?.['deletedAt']).toBeInstanceOf(Date);
        expect(raw?.['version']).toBe(edit.status === 200 ? 3 : 2);
        expect(raw?.['name']).toBe(edit.status === 200 ? 'Edited' : `Race ${String(round)}`);
        expect((await request(app).get(url)).status).toBe(404);
      }
    });
  });

  describe('patch', () => {
    it('re-stamps analyzedAt only when the body carries a source', async () => {
      const created = await create({ source: gcodeSource });
      const url = `${BASE}/${idOf(created)}`;
      const first = (created.body as PartBody).source.analyzedAt;
      clock.advanceSeconds(300);

      const renamed = await request(app).patch(url).send({ version: 1, name: 'Otro' });
      const resourced = await request(app).patch(url).send({ version: 2, source: gcodeSource });

      expect((renamed.body as PartBody).source.analyzedAt).toBe(first);
      expect((resourced.body as PartBody).source.analyzedAt).toBe(clock.now().toISOString());
    });

    it('clears the description with null and replaces the dimensions whole', async () => {
      const created = await create({ description: 'Algo' });
      const url = `${BASE}/${idOf(created)}`;

      const response = await request(app)
        .patch(url)
        .send({ version: 1, description: null, dimensionsMm: { x: 5, y: 6, z: 7 } });

      expect(response.body).toMatchObject({
        description: null,
        dimensionsMm: { x: 5, y: 6, z: 7 },
      });
      expect(await rawOf(idOf(created))).toMatchObject({ description: null });
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

  describe('list', () => {
    it('pages 25 parts with equal names as 10, 10 and 5 with no repeats', async () => {
      for (let n = 0; n < 25; n += 1) await create({ name: 'Same' });

      const pages = await Promise.all(
        [1, 2, 3].map((page) =>
          request(app).get(`${BASE}?page=${String(page)}&pageSize=10&sort=name`),
        ),
      );

      const bodies = pages.map((page) => page.body as { items: PartBody[]; total: number });
      expect(bodies.map((page) => page.items.length)).toEqual([10, 10, 5]);
      expect(bodies.map((page) => page.total)).toEqual([25, 25, 25]);
      const ids = bodies.flatMap((page) => page.items.map((item) => item.id));
      expect(new Set(ids).size).toBe(25);
    });

    it('sorts names without regard to case or accents mixing up the order', async () => {
      for (const name of ['banana', 'Apple', 'ñandú', 'nube', 'cherry']) await create({ name });

      const response = await request(app).get(`${BASE}?sort=name&order=asc`);

      expect((response.body as { items: PartBody[] }).items.map((item) => item.name)).toEqual([
        'Apple',
        'banana',
        'cherry',
        'nube',
        'ñandú',
      ]);
    });

    it('counts only the matches of a filtered name-sorted page', async () => {
      await create({ name: 'A', material: 'PLA' });
      await create({ name: 'B', material: 'PETG' });
      await create({ name: 'C', material: 'PLA' });

      const response = await request(app).get(`${BASE}?material=PLA&sort=name`);

      expect(response.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    });

    it('answers 200 with no items and the real total past the last page', async () => {
      await create();

      const response = await request(app).get(`${BASE}?page=100`);

      expect(response.body).toEqual({ items: [], page: 100, pageSize: 20, total: 1 });
    });

    it('hides deleted parts from the list and the total', async () => {
      const gone = await create({ name: 'Gone' });
      await create({ name: 'Live' });
      await request(app).delete(`${BASE}/${idOf(gone)}`);

      const response = await request(app).get(BASE);

      expect((response.body as { items: PartBody[] }).items.map((item) => item.name)).toEqual([
        'Live',
      ]);
      expect(response.body).toMatchObject({ total: 1 });
    });
  });

  describe('responses', () => {
    it('never exposes internal fields', async () => {
      const created = await create({ source: gcodeSource });

      const read = await request(app).get(`${BASE}/${idOf(created)}`);

      for (const response of [created, read]) {
        expect(response.body).not.toHaveProperty('_id');
        expect(response.body).not.toHaveProperty('__v');
        expect(response.body).not.toHaveProperty('deletedAt');
        expect((response.body as { dimensionsMm: object }).dimensionsMm).not.toHaveProperty('_id');
        expect((response.body as { source: object }).source).not.toHaveProperty('_id');
      }
      expect(read.body).toEqual(created.body);
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
        /mongo|buffer|127\.0\.0\.1|localhost|parts\b.*\bfind/i,
      );
    });
  });
});
