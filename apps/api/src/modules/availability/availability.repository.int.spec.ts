// Integration test: the real schedule repository on a real MongoDB replica set (in memory).
// Races are asserted by what must hold under ANY interleaving, never by one assumed order.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { AppError } from '../../shared/errors/app-error.js';
import { testConfig } from '../../testing/test-app.js';
import { createMongoScheduleRepository } from './availability.repository.js';
import { range, validRules } from './testing/fakes.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');
const T1 = new Date('2026-03-01T11:00:00.000Z');

describe('schedule repository on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoScheduleRepository();
  const collection = () => mongoose.connection.collection('availability');

  async function failureOf(promise: Promise<unknown>): Promise<AppError> {
    const error = await promise.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    if (!(error instanceof AppError)) throw new Error('expected an AppError');
    return error;
  }

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await collection().deleteMany({});
  });

  it('finds nothing and writes nothing before the first save', async () => {
    expect(await repository.find()).toBeNull();
    expect(await collection().countDocuments({})).toBe(0);
  });

  it('creates the singleton with the fixed id and version 1 and reads it back as a plain object', async () => {
    const created = await repository.create(validRules, T0);

    expect(created).toEqual({ ...validRules, version: 1, updatedAt: T0 });
    expect(await repository.find()).toEqual(created);
    const raw = await collection().findOne({});
    expect(raw).toMatchObject({ _id: 'schedule', version: 1, createdAt: T0, updatedAt: T0 });
    expect(raw).not.toHaveProperty('__v');
    expect(raw?.['exceptions']).toEqual([
      { date: new Date('2026-12-25T00:00:00.000Z'), ranges: [] },
    ]);
    expect(raw?.['weekly']).toHaveLength(7);
  });

  it('answers a conflict on version, without driver text, when a document already exists', async () => {
    await repository.create(validRules, T0);

    const error = await failureOf(repository.create({ ...validRules, exceptions: [] }, T1));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(JSON.stringify({ message: error.message, issues: error.issues })).not.toMatch(
      /E11000|dup key/i,
    );
    expect(await repository.find()).toMatchObject({ exceptions: validRules.exceptions });
    expect(await collection().countDocuments({})).toBe(1);
  });

  it('lets exactly one of two simultaneous first saves win and keeps one document', async () => {
    const a = { ...validRules, exceptions: [{ date: '2026-01-01', ranges: [] }] };
    const b = { ...validRules, exceptions: [{ date: '2026-01-02', ranges: [] }] };

    const results = await Promise.allSettled([repository.create(a, T0), repository.create(b, T0)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'conflict' });
    expect(await collection().countDocuments({})).toBe(1);
    // The stored schedule is exactly the winner's, not the loser's and not a mix.
    const winner = results.find((r) => r.status === 'fulfilled');
    expect(await repository.find()).toEqual(winner?.status === 'fulfilled' ? winner.value : null);
  });

  it('updates atomically with the matching version, replaces the content and keeps createdAt', async () => {
    await repository.create(validRules, T0);
    const next = {
      weekly: validRules.weekly.map(() => ({ ranges: [range(0, 1440)] })),
      exceptions: [],
    };

    const updated = await repository.update(next, 1, T1);

    expect(updated).toEqual({ ...next, version: 2, updatedAt: T1 });
    expect(await collection().findOne({})).toMatchObject({ createdAt: T0, version: 2 });
  });

  it('lets exactly one of two simultaneous updates of version 1 win', async () => {
    await repository.create(validRules, T0);
    const a = { ...validRules, exceptions: [{ date: '2026-01-01', ranges: [] }] };
    const b = { ...validRules, exceptions: [{ date: '2026-01-02', ranges: [] }] };

    const results = await Promise.all([repository.update(a, 1, T1), repository.update(b, 1, T1)]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    const winner = results.find((r) => r !== null);
    expect(await repository.find()).toEqual(winner);
    expect(winner?.version).toBe(2);
  });

  it('returns null and writes nothing for a stale version or an empty collection', async () => {
    expect(await repository.update(validRules, 1, T1)).toBeNull();
    await repository.create(validRules, T0);

    expect(await repository.update({ ...validRules, exceptions: [] }, 2, T1)).toBeNull();

    expect(await repository.find()).toEqual({ ...validRules, version: 1, updatedAt: T0 });
  });

  it('rejects a value outside the limits with a generic 503 and keeps the stored data', async () => {
    await repository.create(validRules, T0);
    const weekly = validRules.weekly.map((day, i) =>
      i === 0 ? { ranges: [range(0, 1441)] } : day,
    );

    const error = await failureOf(repository.update({ ...validRules, weekly }, 1, T1));

    expect(error.code).toBe('service_unavailable');
    expect(error.message).not.toMatch(/validation|endMinute/i);
    expect(await repository.find()).toEqual({ ...validRules, version: 1, updatedAt: T0 });
  });

  it('has no index beyond _id', async () => {
    await repository.create(validRules, T0);

    const indexes = await collection().indexes();

    expect(indexes.map((index) => index.name)).toEqual(['_id_']);
  });
});
