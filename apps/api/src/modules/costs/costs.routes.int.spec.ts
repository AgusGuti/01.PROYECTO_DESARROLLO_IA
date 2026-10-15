// Integration test: the whole stack with the REAL wiring of app.ts (real repositories and real
// provider factories for the three ports, ADR 0017/0020) on a real MongoDB replica set. A
// structural mismatch between a provider and a port would show up only here.
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
import { createTestClock, validRates } from './testing/fakes.js';

const ESTIMATES = '/api/v1/costs/estimates';
const SETTINGS = '/api/v1/costs/settings';

const partBody = {
  name: 'Soporte',
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 100,
  estimatedPrintSeconds: 7200,
  layerHeightUm: 200,
};
const filamentBody = {
  brand: 'Grilon3',
  material: 'PETG',
  colorName: 'Negro',
  initialGrams: 1000,
  purchaseCostMinor: 2_000_000,
  purchaseDate: '2026-02-17',
};
const printerBody = {
  name: 'Ender 3',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.4, material: 'brass' },
  compatibleMaterials: ['PLA', 'PETG'],
  powerWatts: 270,
};

describe('costs API on a real MongoDB with the real wiring', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;
  const clock = createTestClock();
  const settings = () => mongoose.connection.collection('settings');

  const idOf = (response: request.Response): string => (response.body as { id: string }).id;
  const makePart = async () => idOf(await request(app).post('/api/v1/parts').send(partBody));
  const makeFilament = async () =>
    idOf(await request(app).post('/api/v1/filaments').send(filamentBody));
  const makePrinter = async (overrides: Record<string, unknown> = {}) =>
    idOf(
      await request(app)
        .post('/api/v1/printers')
        .send({ ...printerBody, ...overrides }),
    );
  const put = (version: number, overrides: Record<string, unknown> = {}) =>
    request(app)
      .put(SETTINGS)
      .send({ ...validRates, version, ...overrides });

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
    await Promise.all(
      ['settings', 'parts', 'filaments', 'printers'].map((name) =>
        mongoose.connection.collection(name).deleteMany({}),
      ),
    );
  });

  describe('settings', () => {
    it('answers the defaults without creating a document', async () => {
      const response = await request(app).get(SETTINGS);

      expect(response.body).toEqual({
        kwhPriceMinor: 0,
        wearPerHourMinor: 0,
        fixedPerJobMinor: 0,
        defaultMarginBasisPoints: 0,
        version: 0,
        updatedAt: null,
      });
      expect(await settings().countDocuments({})).toBe(0);
    });

    it('saves version 0, then 1, and reads the saved values back', async () => {
      const first = await put(0);
      const second = await put(1, { kwhPriceMinor: 9000 });

      expect(first.body).toMatchObject({ version: 1, kwhPriceMinor: 8000 });
      expect(second.body).toMatchObject({ version: 2, kwhPriceMinor: 9000 });
      expect((await request(app).get(SETTINGS)).body).toEqual(second.body);
    });

    it('answers 409 on version for a stale version and for version 0 over an existing document', async () => {
      await put(0);

      const stale = await put(7);
      const zero = await put(0);

      for (const response of [stale, zero]) {
        expect(response.status).toBe(409);
        expect(problemSchema.parse(response.body).issues).toEqual([
          { path: 'version', message: 'Does not match the current version.' },
        ]);
      }
    });

    it('lets exactly one of two simultaneous first saves win and keeps one document', async () => {
      const responses = await Promise.all([
        put(0, { kwhPriceMinor: 1 }),
        put(0, { kwhPriceMinor: 2 }),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await settings().countDocuments({})).toBe(1);
      const winner = responses.find((r) => r.status === 200);
      expect((await request(app).get(SETTINGS)).body).toEqual(winner?.body);
    });

    it('lets exactly one of two simultaneous saves of version 1 win', async () => {
      await put(0);

      const responses = await Promise.all([
        put(1, { kwhPriceMinor: 1 }),
        put(1, { kwhPriceMinor: 2 }),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await settings().countDocuments({})).toBe(1);
      // The stored values are exactly the winner's, not the loser's and not a mix.
      const winner = responses.find((r) => r.status === 200);
      expect(await settings().findOne({})).toMatchObject({
        version: 2,
        kwhPriceMinor: (winner?.body as { kwhPriceMinor: number }).kwhPriceMinor,
      });
    });

    it('has only the _id index', async () => {
      await put(0);

      const indexes = await settings().indexes();

      expect(indexes.map((index) => index.name)).toEqual(['_id_']);
    });
  });

  describe('estimates through the real part, spool and printer readers', () => {
    it('reproduces the worked example from documents created through their own APIs', async () => {
      await put(0);
      const body = {
        partId: await makePart(),
        filamentId: await makeFilament(),
        printerId: await makePrinter(),
        quantity: 2,
        marginBasisPoints: 2500,
      };

      const response = await request(app).post(ESTIMATES).send(body);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        subtotalMinor: 414_240,
        marginMinor: 103_560,
        totalMinor: 517_800,
        unitTotalMinor: 258_900,
        electricity: { watts: 270, costMinor: 8640 },
        warnings: [],
      });
    });

    it('writes nothing: the collections are unchanged by an estimate', async () => {
      const body = { partId: await makePart(), filamentId: await makeFilament() };

      await request(app).post(ESTIMATES).send(body);

      expect(await settings().countDocuments({})).toBe(0);
      expect(await mongoose.connection.collection('parts').countDocuments({})).toBe(1);
    });

    it('finds a printer that is pending removal (archived)', async () => {
      await put(0);
      const printerId = await makePrinter({ status: 'in_use' });
      expect((await request(app).delete(`/api/v1/printers/${printerId}`)).status).toBe(204);
      expect(await mongoose.connection.collection('printers').findOne({})).toMatchObject({
        archivedAt: expect.any(Date),
        deletedAt: null,
      });

      const response = await request(app)
        .post(ESTIMATES)
        .send({ partId: await makePart(), filamentId: await makeFilament(), printerId });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ electricity: { watts: 270 } });
    });

    it('treats a deleted printer, part and spool as missing, all reported together', async () => {
      const partId = await makePart();
      const filamentId = await makeFilament();
      const printerId = await makePrinter();
      await request(app).delete(`/api/v1/printers/${printerId}`);
      await request(app).delete(`/api/v1/parts/${partId}`);
      await request(app).delete(`/api/v1/filaments/${filamentId}`);

      const response = await request(app).post(ESTIMATES).send({ partId, filamentId, printerId });

      expect(response.status).toBe(400);
      expect(problemSchema.parse(response.body).issues?.map((issue) => issue.path)).toEqual([
        'partId',
        'filamentId',
        'printerId',
      ]);
    });

    it('omits electricity with a warning for a printer without power (an old document)', async () => {
      await put(0);
      const printerId = await makePrinter({ powerWatts: undefined });

      const response = await request(app)
        .post(ESTIMATES)
        .send({ partId: await makePart(), filamentId: await makeFilament(), printerId });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        electricity: null,
        warnings: [{ code: 'electricity_printer_power_unknown' }],
      });
    });

    it('rejects a spool of another material', async () => {
      const spool = await request(app)
        .post('/api/v1/filaments')
        .send({ ...filamentBody, material: 'PLA' });

      const response = await request(app)
        .post(ESTIMATES)
        .send({ partId: await makePart(), filamentId: idOf(spool) });

      expect(response.status).toBe(400);
      expect(problemSchema.parse(response.body).issues).toEqual([
        { path: 'filamentId', message: 'The spool material differs from the part material.' },
      ]);
    });
  });
});
