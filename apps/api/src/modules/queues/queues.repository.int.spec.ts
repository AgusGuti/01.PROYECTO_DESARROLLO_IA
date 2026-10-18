// Integration test: the real queue repository on a real MongoDB replica set (in memory).
// Races are asserted by what must hold under ANY interleaving, never by one assumed order.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { AppError } from '../../shared/errors/app-error.js';
import { testConfig } from '../../testing/test-app.js';
import { createMongoQueueRepository } from './queues.repository.js';
import {
  line,
  PART_A,
  PART_B,
  PRINTER_1,
  PRINTER_2,
  PRINTER_3,
  PROJECT_ID,
  validFields,
} from './testing/fakes.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');
const T1 = new Date('2026-03-01T11:00:00.000Z');

describe('queue repository on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoQueueRepository();
  const collection = () => mongoose.connection.collection('queues');

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
    await repository.ensureIndexes();
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await collection().deleteMany({});
  });

  it('creates with _id = the project id and version 1 and reads it back as a plain object', async () => {
    const created = await repository.create(PROJECT_ID, validFields, T0);

    expect(created).toEqual({
      id: PROJECT_ID,
      ...validFields,
      version: 1,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(await repository.findById(PROJECT_ID)).toEqual(created);
    const raw = await collection().findOne({});
    expect(raw).toMatchObject({ _id: PROJECT_ID, version: 1 });
    expect(raw).not.toHaveProperty('__v');
  });

  it('finds nothing for an unknown id', async () => {
    expect(await repository.findById(PROJECT_ID)).toBeNull();
  });

  it('answers a conflict on projectId, without driver text, for a second create', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    const error = await failureOf(
      repository.create(PROJECT_ID, { ...validFields, goal: 'deadline' }, T1),
    );

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'projectId' }] });
    expect(JSON.stringify({ message: error.message, issues: error.issues })).not.toMatch(
      /E11000|dup key/i,
    );
    expect(await collection().countDocuments({})).toBe(1);
    expect((await repository.findById(PROJECT_ID))?.goal).toBe('fastest');
  });

  it('lets exactly one of two simultaneous creates for a project win', async () => {
    const results = await Promise.allSettled([
      repository.create(PROJECT_ID, { ...validFields, goal: 'deadline' }, T0),
      repository.create(PROJECT_ID, { ...validFields, goal: 'minimal_idle' }, T0),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'conflict' });
    expect(await collection().countDocuments({})).toBe(1);
    const winner = results.find((r) => r.status === 'fulfilled');
    expect(await repository.findById(PROJECT_ID)).toEqual(
      winner?.status === 'fulfilled' ? winner.value : null,
    );
  });

  it('updates atomically with the matching version and keeps createdAt', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    const updated = await repository.update(
      PROJECT_ID,
      1,
      { mode: 'multi', printerIds: [PRINTER_1, PRINTER_2], lines: [line(PART_B, 2, 2)] },
      T1,
    );

    expect(updated).toMatchObject({
      mode: 'multi',
      printerIds: [PRINTER_1, PRINTER_2],
      lines: [line(PART_B, 2, 2)],
      goal: 'fastest',
      version: 2,
      createdAt: T0,
      updatedAt: T1,
    });
  });

  it('returns null and writes nothing for a stale version', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    expect(await repository.update(PROJECT_ID, 2, { goal: 'deadline' }, T1)).toBeNull();

    expect(await repository.findById(PROJECT_ID)).toMatchObject({ goal: 'fastest', version: 1 });
  });

  it('lets exactly one of two simultaneous updates of version 1 win', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    const results = await Promise.all([
      repository.update(PROJECT_ID, 1, { goal: 'deadline' }, T1),
      repository.update(PROJECT_ID, 1, { goal: 'minimal_idle' }, T1),
    ]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await repository.findById(PROJECT_ID)).toEqual(results.find((r) => r !== null));
  });

  it('rejects a value outside the limits with a generic 503 and keeps the stored data', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    const error = await failureOf(
      repository.update(PROJECT_ID, 1, { lines: [line(PART_B, 1001)] }, T1),
    );

    expect(error.code).toBe('service_unavailable');
    expect(error.message).not.toMatch(/validation|quantity/i);
    expect(await repository.findById(PROJECT_ID)).toMatchObject({
      lines: validFields.lines,
      version: 1,
    });
  });

  it('deletes only with the matching version', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    expect(await repository.remove(PROJECT_ID, 2)).toBe(false);
    expect(await collection().countDocuments({})).toBe(1);
    expect(await repository.remove(PROJECT_ID, 1)).toBe(true);
    expect(await collection().countDocuments({})).toBe(0);
    expect(await repository.remove(PROJECT_ID, 1)).toBe(false);
  });

  it('lets exactly one of a simultaneous update and delete of version 1 win', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    const [updated, removed] = await Promise.all([
      repository.update(PROJECT_ID, 1, { goal: 'deadline' }, T1),
      repository.remove(PROJECT_ID, 1),
    ]);

    expect(updated !== null).not.toBe(removed);
    expect(await collection().countDocuments({})).toBe(removed ? 0 : 1);
  });

  it('has only _id and the printer id index', async () => {
    await repository.create(PROJECT_ID, validFields, T0);

    expect((await collection().indexes()).map((index) => index.name).sort()).toEqual([
      '_id_',
      'queues_printer_ids',
    ]);
  });

  describe('hasPendingWorkFor', () => {
    const OTHER_PROJECT = '2'.repeat(24);

    it('is true for a printer of a queue with a line still to print', async () => {
      await repository.create(
        PROJECT_ID,
        { ...validFields, lines: [line(PART_A, 2, 2), line(PART_B, 3, 1)] },
        T0,
      );

      expect(await repository.hasPendingWorkFor(PRINTER_1)).toBe(true);
    });

    it('is false when every line of the queue is completed', async () => {
      await repository.create(PROJECT_ID, { ...validFields, lines: [line(PART_A, 4, 4)] }, T0);

      expect(await repository.hasPendingWorkFor(PRINTER_1)).toBe(false);
    });

    it('is false for a queue without lines', async () => {
      await repository.create(PROJECT_ID, { ...validFields, lines: [] }, T0);

      expect(await repository.hasPendingWorkFor(PRINTER_1)).toBe(false);
    });

    it('is false for a printer that no queue selects, and true for any printer of a multi queue', async () => {
      await repository.create(
        PROJECT_ID,
        { ...validFields, mode: 'multi', printerIds: [PRINTER_1, PRINTER_2] },
        T0,
      );

      expect(await repository.hasPendingWorkFor(PRINTER_3)).toBe(false);
      expect(await repository.hasPendingWorkFor(PRINTER_2)).toBe(true);
    });

    it('looks at all the queues of the printer, not only the first', async () => {
      await repository.create(PROJECT_ID, { ...validFields, lines: [line(PART_A, 4, 4)] }, T0);
      await repository.create(OTHER_PROJECT, validFields, T0);

      expect(await repository.hasPendingWorkFor(PRINTER_1)).toBe(true);
    });

    it('uses the printer id index', async () => {
      await repository.create(PROJECT_ID, validFields, T0);

      const plan = await collection().find({ printerIds: PRINTER_1 }).explain('queryPlanner');

      expect(JSON.stringify(plan)).toContain('IXSCAN');
    });
  });
});
