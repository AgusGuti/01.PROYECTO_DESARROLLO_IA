// Integration test: the whole stack with the REAL wiring of app.ts (real repositories and real
// provider factories for the three ports, ADR 0017/0025) on a real MongoDB replica set. A
// structural mismatch between a provider and a port would show up only here.
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { createTestApp, testConfig } from '../../testing/test-app.js';
import { createTestClock } from './testing/fakes.js';

const partBody = (name: string, seconds: number) => ({
  name,
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: seconds,
  layerHeightUm: 200,
});
const printerBody = (name: string) => ({
  name,
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.4, material: 'brass' },
  compatibleMaterials: ['PLA', 'PETG'],
});

describe('queues API on a real MongoDB with the real wiring', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;

  const idOf = (response: request.Response): string => (response.body as { id: string }).id;
  const makePart = async (name: string, seconds: number) =>
    idOf(await request(app).post('/api/v1/parts').send(partBody(name, seconds)));
  const makePrinter = async (name: string) =>
    idOf(await request(app).post('/api/v1/printers').send(printerBody(name)));
  const makeProject = async (items: unknown[]) =>
    idOf(await request(app).post('/api/v1/projects').send({ name: 'Taller', items }));

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
    app = createTestApp({ database, clock: createTestClock(), env: { RATE_LIMIT_MAX: '100000' } });
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    for (const name of ['queues', 'projects', 'parts', 'printers']) {
      await mongoose.connection.collection(name).deleteMany({});
    }
  });

  it('creates from the project items, enriches with the real part data and edits and deletes', async () => {
    const part = await makePart('Soporte', 3600);
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([{ partId: part, quantity: 3 }]);

    const created = await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      projectId: project,
      lines: [{ partId: part, quantity: 3, completed: 0, partName: 'Soporte', partDeleted: false }],
      totals: { pendingUnits: 3, pendingSeconds: 10_800 },
    });

    const edited = await request(app)
      .patch(`/api/v1/queues/${project}`)
      .send({ version: 1, lines: [{ partId: part, quantity: 3, completed: 1 }] });
    expect(edited.body).toMatchObject({ version: 2, totals: { pendingSeconds: 7200 } });

    const removed = await request(app).delete(`/api/v1/queues/${project}`).query({ version: 2 });
    expect(removed.status).toBe(204);
    expect((await request(app).get(`/api/v1/queues/${project}`)).status).toBe(404);
  });

  it('keeps its own lines when the project is edited afterwards', async () => {
    const part = await makePart('Soporte', 600);
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([{ partId: part, quantity: 3 }]);
    await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'deadline', mode: 'single', printerIds: [printer] });

    await request(app)
      .patch(`/api/v1/projects/${project}`)
      .send({ version: 1, items: [{ partId: part, quantity: 9 }] });

    const queue = await request(app).get(`/api/v1/queues/${project}`);
    expect(queue.body).toMatchObject({ lines: [{ quantity: 3 }] });
  });

  it('refuses an archived printer for a new selection', async () => {
    const printer = await makePrinter('Vieja');
    const project = await makeProject([]);
    await request(app).delete(`/api/v1/printers/${printer}`);
    const raw = await mongoose.connection.collection('printers').findOne({});

    const response = await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] });

    expect(raw?.['archivedAt'] ?? raw?.['deletedAt']).toBeTruthy();
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ issues: [{ path: 'printerIds.0' }] });
  });

  it('flags a part deleted after the queue was created', async () => {
    const part = await makePart('Soporte', 600);
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([{ partId: part, quantity: 2 }]);
    await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] });
    await mongoose.connection
      .collection('parts')
      .updateOne({ _id: new mongoose.Types.ObjectId(part) }, { $set: { deletedAt: new Date() } });

    const response = await request(app).get(`/api/v1/queues/${project}`);

    expect(response.body).toMatchObject({
      lines: [{ partDeleted: true, partName: null }],
      totals: { pendingUnits: 2, pendingSeconds: 0 },
    });
  });

  it('answers 409 for a second queue of the same project, and exactly one of two simultaneous creates wins', async () => {
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([]);
    const create = () =>
      request(app)
        .post('/api/v1/queues')
        .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] });

    const [a, b] = await Promise.all([create(), create()]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await mongoose.connection.collection('queues').countDocuments({})).toBe(1);
    const loser = a.status === 409 ? a : b;
    expect(loser.body).toMatchObject({ issues: [{ path: 'projectId' }] });
  });

  it('answers 400 for a removed project', async () => {
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([]);
    await request(app).delete(`/api/v1/projects/${project}`);

    const response = await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ issues: [{ path: 'projectId' }] });
  });
});
