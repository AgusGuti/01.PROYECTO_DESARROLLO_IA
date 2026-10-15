// Integration test: filaments declare no index, so a production-mode start (autoIndex off, no
// `npm run db:indexes` step for them) must work: create, read and list all succeed.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { testConfig } from '../../testing/test-app.js';
import { createMongoFilamentRepository } from './filaments.repository.js';
import { validFields } from './testing/fakes.js';

describe('filaments when the database runs like production', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoFilamentRepository();

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

  it('works with no index created and leaves only the _id index', async () => {
    const created = await repository.create(validFields, new Date('2026-03-01T10:00:00.000Z'));

    const listed = await repository.list({
      page: 1,
      pageSize: 20,
      sort: 'createdAt',
      order: 'desc',
    });

    expect(listed).toEqual({ items: [created], total: 1 });
    const indexes = await mongoose.connection.collection('filaments').listIndexes().toArray();
    expect(indexes.map((index): unknown => index.name)).toEqual(['_id_']);
  });
});
