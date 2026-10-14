// Integration test: with autoIndex off (as in production) nothing creates the unique name index
// by itself. The API must refuse to start without it, and `npm run db:indexes` must create it.
// Without the index two printers could share a name.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { testConfig } from '../../testing/test-app.js';
import { assertPrintersIndexes, ensurePrintersIndexes } from './index.js';
import { createMongoPrinterRepository } from './printers.repository.js';
import { validFields } from './testing/fakes.js';

const NOW = new Date('2026-03-01T10:00:00.000Z');

describe('printers indexes when the database runs like production', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoPrinterRepository();

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ NODE_ENV: 'production', MONGODB_URI: mongo.getUri('print3d-startup') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  it('refuses to start while the unique name index is missing, even if the collection exists', async () => {
    await repository.create({ ...validFields, name: 'Ender 3' }, NOW);
    await repository.create({ ...validFields, name: 'ender 3' }, NOW);

    await expect(assertPrintersIndexes()).rejects.toThrow('npm run db:indexes');
    expect(await repository.hasUniqueNameIndex()).toBe(false);
  });

  it('creates the index on demand and then rejects a duplicate name', async () => {
    await mongoose.connection.collection('printers').deleteMany({});

    await ensurePrintersIndexes();

    await expect(assertPrintersIndexes()).resolves.toBeUndefined();
    const indexes = await mongoose.connection.collection('printers').listIndexes().toArray();
    expect(indexes.map((index): unknown => index.name)).toContain('printers_name_unique');
    await repository.create({ ...validFields, name: 'Ender 3' }, NOW);
    await expect(repository.create({ ...validFields, name: 'ENDER 3' }, NOW)).rejects.toMatchObject(
      { code: 'conflict' },
    );
  });

  it('can be run again without failing', async () => {
    await expect(ensurePrintersIndexes()).resolves.toBeUndefined();
    await expect(assertPrintersIndexes()).resolves.toBeUndefined();
  });
});
