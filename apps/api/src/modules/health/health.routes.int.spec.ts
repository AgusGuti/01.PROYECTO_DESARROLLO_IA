// Integration test: real MongoDB (in-memory server started as a replica set, like production),
// real connection code, real Express app. Slower than unit tests; run with `npm run test:int`.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { createTestApp, testConfig } from '../../testing/test-app.js';

describe('readiness against a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;

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

  it('reports ready while connected', async () => {
    const response = await request(createTestApp({ database })).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ready', checks: { database: 'up' } });
  });

  it('reports not ready after the connection is closed', async () => {
    await database.disconnect();

    const response = await request(createTestApp({ database })).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'not_ready', checks: { database: 'down' } });
  });
});
