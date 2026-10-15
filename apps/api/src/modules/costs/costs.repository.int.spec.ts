// Integration test: the real settings repository on a real MongoDB replica set (in memory).
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { AppError } from '../../shared/errors/app-error.js';
import { testConfig } from '../../testing/test-app.js';
import { createMongoCostSettingsRepository } from './costs.repository.js';
import { validRates } from './testing/fakes.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');
const T1 = new Date('2026-03-01T11:00:00.000Z');

describe('cost settings repository on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoCostSettingsRepository();
  const collection = () => mongoose.connection.collection('settings');

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
    const created = await repository.create(validRates, T0);

    expect(created).toEqual({ ...validRates, version: 1, updatedAt: T0 });
    expect(await repository.find()).toEqual(created);
    const raw = await collection().findOne({});
    expect(raw).toMatchObject({
      _id: 'costs',
      ...validRates,
      version: 1,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(raw).not.toHaveProperty('__v');
  });

  it('answers a conflict on version, without driver text, when a document already exists', async () => {
    await repository.create(validRates, T0);

    const error = await failureOf(repository.create({ ...validRates, kwhPriceMinor: 1 }, T1));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(JSON.stringify({ message: error.message, issues: error.issues })).not.toMatch(
      /E11000|dup key/i,
    );
    expect(await repository.find()).toMatchObject({ kwhPriceMinor: validRates.kwhPriceMinor });
    expect(await collection().countDocuments({})).toBe(1);
  });

  it('updates atomically with the matching version, bumps it and keeps createdAt', async () => {
    await repository.create(validRates, T0);

    const updated = await repository.update({ ...validRates, fixedPerJobMinor: 7 }, 1, T1);

    expect(updated).toEqual({ ...validRates, fixedPerJobMinor: 7, version: 2, updatedAt: T1 });
    expect(await collection().findOne({})).toMatchObject({ createdAt: T0, version: 2 });
  });

  it('returns null and writes nothing for a stale version or an empty collection', async () => {
    expect(await repository.update(validRates, 1, T1)).toBeNull();
    await repository.create(validRates, T0);

    expect(await repository.update({ ...validRates, kwhPriceMinor: 1 }, 2, T1)).toBeNull();

    expect(await repository.find()).toEqual({ ...validRates, version: 1, updatedAt: T0 });
  });

  it('rejects a value outside the limits with a generic 503 and keeps the stored data', async () => {
    await repository.create(validRates, T0);

    const error = await failureOf(repository.update({ ...validRates, kwhPriceMinor: -1 }, 1, T1));

    expect(error.code).toBe('service_unavailable');
    expect(error.message).not.toMatch(/validation|kwhPriceMinor/i);
    expect(await repository.find()).toEqual({ ...validRates, version: 1, updatedAt: T0 });
  });

  it('has no index beyond _id', async () => {
    await repository.create(validRates, T0);

    const indexes = await collection().indexes();

    expect(indexes.map((index) => index.name)).toEqual(['_id_']);
  });
});
