// Integration test: the whole stack with the REAL wiring of app.ts on a real MongoDB replica set.
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
import { createTestClock, validRules } from './testing/fakes.js';

const SCHEDULE = '/api/v1/availability/schedule';

describe('availability API on a real MongoDB with the real wiring', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;
  const clock = createTestClock();
  const collection = () => mongoose.connection.collection('availability');
  const put = (version: number, overrides: Record<string, unknown> = {}) =>
    request(app)
      .put(SCHEDULE)
      .send({ ...validRules, version, ...overrides });

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

  it('answers the defaults without creating a document', async () => {
    const response = await request(app).get(SCHEDULE);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ version: 0, updatedAt: null, exceptions: [] });
    expect((response.body as { weekly: unknown[] }).weekly).toHaveLength(7);
    expect(await collection().countDocuments({})).toBe(0);
  });

  it('saves version 0, then 1, and reads the saved schedule back', async () => {
    const first = await put(0);
    const second = await put(1, { exceptions: [] });

    expect(first.body).toMatchObject({ version: 1, exceptions: validRules.exceptions });
    expect(second.body).toMatchObject({ version: 2, exceptions: [] });
    expect((await request(app).get(SCHEDULE)).body).toEqual(second.body);
  });

  it('answers 409 on version for a stale version and for version 0 over an existing document', async () => {
    await put(0);

    for (const response of [await put(7), await put(0)]) {
      expect(response.status).toBe(409);
      expect(problemSchema.parse(response.body).issues).toEqual([
        { path: 'version', message: 'Does not match the current version.' },
      ]);
    }
  });

  it('answers absences: [] for a document saved before absences existed', async () => {
    await mongoose.connection
      .collection<{ _id: string; [key: string]: unknown }>('availability')
      .insertOne({
        _id: 'schedule',
        weekly: validRules.weekly,
        exceptions: [],
        version: 1,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });

    const response = await request(app).get(SCHEDULE);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ version: 1, absences: [] });
  });

  it('saves absences and reads them back as YYYY-MM-DD', async () => {
    const saved = await put(0);

    expect(saved.body).toMatchObject({ absences: [{ from: '2026-12-28', to: '2027-01-03' }] });
    expect((await request(app).get(SCHEDULE)).body).toEqual(saved.body);
  });

  it('answers 400 with the exact path for an overlapping absence', async () => {
    const response = await put(0, {
      absences: [
        { from: '2026-03-10', to: '2026-03-12' },
        { from: '2026-03-11', to: '2026-03-15' },
      ],
    });

    expect(response.status).toBe(400);
    expect(problemSchema.parse(response.body).issues?.map((i) => i.path)).toEqual([
      'absences.1.from',
    ]);
    expect(await collection().countDocuments({})).toBe(0);
  });

  it('answers 400 with the exact path for an overlap', async () => {
    const weekly = validRules.weekly.map((day, i) =>
      i === 1
        ? {
            ranges: [
              { startMinute: 0, endMinute: 100 },
              { startMinute: 50, endMinute: 200 },
            ],
          }
        : day,
    );

    const response = await put(0, { weekly });

    expect(response.status).toBe(400);
    expect(problemSchema.parse(response.body).issues?.map((i) => i.path)).toEqual([
      'weekly.1.ranges.1.startMinute',
    ]);
    expect(await collection().countDocuments({})).toBe(0);
  });

  it('lets exactly one of two simultaneous first saves win and keeps one document', async () => {
    const responses = await Promise.all([
      put(0, { exceptions: [{ date: '2026-01-01', ranges: [] }] }),
      put(0, { exceptions: [{ date: '2026-01-02', ranges: [] }] }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await collection().countDocuments({})).toBe(1);
    const winner = responses.find((r) => r.status === 200);
    expect((await request(app).get(SCHEDULE)).body).toEqual(winner?.body);
  });

  it('lets exactly one of two simultaneous saves of version 1 win', async () => {
    await put(0);

    const responses = await Promise.all([
      put(1, { exceptions: [{ date: '2026-01-01', ranges: [] }] }),
      put(1, { exceptions: [{ date: '2026-01-02', ranges: [] }] }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses.find((r) => r.status === 200);
    expect((await request(app).get(SCHEDULE)).body).toEqual(winner?.body);
    expect(await collection().countDocuments({})).toBe(1);
  });
});
