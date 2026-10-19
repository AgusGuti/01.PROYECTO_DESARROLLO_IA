// Integration test: the whole stack with the REAL wiring of app.ts (the five real provider
// factories, ADR 0017/0026) on a real MongoDB replica set. A structural mismatch between a
// provider and a port would show up only here.
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { createTestApp, testConfig } from '../../testing/test-app.js';
import { optimizationSchema, simulationSchema } from './simulations.schemas.js';

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

describe('simulations API on a real MongoDB with the real wiring', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;

  const idOf = (response: request.Response): string => (response.body as { id: string }).id;
  const makePart = async (name: string, seconds: number) =>
    idOf(await request(app).post('/api/v1/parts').send(partBody(name, seconds)));
  const makePrinter = async (name: string) =>
    idOf(await request(app).post('/api/v1/printers').send(printerBody(name)));
  const makeProject = async (items: unknown[], deadline?: string) =>
    idOf(
      await request(app)
        .post('/api/v1/projects')
        .send({ name: 'Taller', items, ...(deadline === undefined ? {} : { deadline }) }),
    );

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
    app = createTestApp({ database, env: { RATE_LIMIT_MAX: '100000' } });
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    for (const name of [
      'availability',
      'queues',
      'projects',
      'parts',
      'printers',
      'planningSettings',
    ]) {
      await mongoose.connection.collection(name).deleteMany({});
    }
  });

  it('simulates a real queue with the default schedule and the project deadline', async () => {
    const part = await makePart('Soporte', 7200);
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([{ partId: part, quantity: 3 }], '2026-03-02');
    await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'deadline', mode: 'single', printerIds: [printer] })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/simulations')
      .send({ projectId: project, startAt: '2026-03-02T08:00' });

    expect(response.status).toBe(200);
    const dto = simulationSchema.parse(response.body);
    expect(dto.jobs.map((job) => job.handoffAt)).toEqual([
      '2026-03-02T10:00',
      '2026-03-02T12:00',
      '2026-03-02T14:00',
    ]);
    expect(dto.printers[0]).toMatchObject({
      printerId: printer,
      name: 'Ender 3',
      busyMinutes: 360,
    });
    expect(dto.deadline).toEqual({ date: '2026-03-02', met: true });
    expect(dto.goal).toBe('deadline');
    expect(dto.warnings).toEqual([{ code: 'availability_not_configured' }]);
    expect(await mongoose.connection.collection('availability').countDocuments()).toBe(0);
  });

  it('uses the saved schedule and drops an archived printer with a warning', async () => {
    const part = await makePart('Soporte', 3600);
    const first = await makePrinter('Ender 3');
    const second = await makePrinter('Prusa');
    const project = await makeProject([{ partId: part, quantity: 2 }]);
    await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'multi', printerIds: [first, second] })
      .expect(201);
    // Open only from 10:00 to 12:00 every day.
    await request(app)
      .put('/api/v1/availability/schedule')
      .send({
        weekly: Array.from({ length: 7 }, () => ({
          ranges: [{ startMinute: 600, endMinute: 720 }],
        })),
        exceptions: [],
        absences: [],
        version: 0,
      })
      .expect(200);
    // The first DELETE of a printer archives it (ADR 0006).
    const archived = await request(app).delete(`/api/v1/printers/${second}`);
    expect(archived.status).toBeLessThan(300);

    const response = await request(app)
      .post('/api/v1/simulations')
      .send({ projectId: project, startAt: '2026-03-02T08:00' });

    expect(response.status).toBe(200);
    const dto = simulationSchema.parse(response.body);
    expect(dto.jobs.map((job) => [job.printerId, job.startAt])).toEqual([
      [first, '2026-03-02T10:00'],
      [first, '2026-03-02T11:00'],
    ]);
    expect(dto.warnings).toEqual([{ code: 'printer_unavailable' }]);
  });

  it('optimises with the real wiring: part size, printer bed and the saved batch saving', async () => {
    // 60 x 40 mm pieces on a 220 x 220 bed: 12 fit on a plate, so 4 share one.
    const part = await makePart('Soporte', 3600);
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([{ partId: part, quantity: 4 }]);
    await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] })
      .expect(201);
    await request(app)
      .put('/api/v1/planning/settings')
      .send({ batchSavingBasisPoints: 2500, version: 0 })
      .expect(200);

    const response = await request(app)
      .post('/api/v1/simulations/optimizations')
      .send({ projectId: project, startAt: '2026-03-02T08:00' });

    expect(response.status).toBe(200);
    const dto = optimizationSchema.parse(response.body);
    // 4 * 3600 s * 75 % = 180 min, against four 60 min prints one after the other.
    expect(dto.strategy).toBe('queue_order');
    expect(dto.optimized.jobs).toMatchObject([
      { units: 4, printerId: printer, startAt: '2026-03-02T08:00', endAt: '2026-03-02T11:00' },
    ]);
    expect(dto.baseline.totals.finishAt).toBe('2026-03-02T12:00');
    expect(dto.comparison.finishDeltaMinutes).toBe(-60);
    expect(dto.warnings).toEqual([
      { code: 'availability_not_configured' },
      { code: 'batching_applied' },
    ]);
    expect(await mongoose.connection.collection('planningSettings').countDocuments()).toBe(1);
  });

  it('optimises with the default saving of zero when the settings were never saved', async () => {
    const part = await makePart('Soporte', 3600);
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([{ partId: part, quantity: 2 }]);
    await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/simulations/optimizations')
      .send({ projectId: project, startAt: '2026-03-02T08:00' });

    expect(response.status).toBe(200);
    const dto = optimizationSchema.parse(response.body);
    // Two pieces on one plate take as long as two separate prints, so naive wins the tie.
    expect(dto.strategy).toBe('naive');
    expect(await mongoose.connection.collection('planningSettings').countDocuments()).toBe(0);
  });

  it('optimises from a start date inside a saved absence: nothing starts before it ends', async () => {
    const part = await makePart('Soporte', 3600);
    const printer = await makePrinter('Ender 3');
    const project = await makeProject([{ partId: part, quantity: 2 }]);
    await request(app)
      .post('/api/v1/queues')
      .send({ projectId: project, goal: 'fastest', mode: 'single', printerIds: [printer] })
      .expect(201);
    // Open 08:00-18:00 every day, but absent on Mon 2026-03-02 and Tue 2026-03-03.
    await request(app)
      .put('/api/v1/availability/schedule')
      .send({
        weekly: Array.from({ length: 7 }, () => ({
          ranges: [{ startMinute: 480, endMinute: 1080 }],
        })),
        exceptions: [],
        absences: [{ from: '2026-03-02', to: '2026-03-03' }],
        version: 0,
      })
      .expect(200);

    const response = await request(app)
      .post('/api/v1/simulations/optimizations')
      .send({ projectId: project, startAt: '2026-03-02T08:00' });

    expect(response.status).toBe(200);
    const dto = optimizationSchema.parse(response.body);
    expect(dto.optimized.jobs.map((job) => job.startAt)).toEqual([
      '2026-03-04T08:00',
      '2026-03-04T09:00',
    ]);
    expect(dto.baseline.totals.finishAt).toBe('2026-03-04T10:00');
    expect(dto.warnings).toEqual([]);
  });

  it('answers 400 when the project has no queue', async () => {
    const part = await makePart('Soporte', 3600);
    const project = await makeProject([{ partId: part, quantity: 1 }]);

    const response = await request(app)
      .post('/api/v1/simulations')
      .send({ projectId: project, startAt: '2026-03-02T08:00' });

    expect(response.status).toBe(400);
    expect((response.body as { issues: { path: string }[] }).issues[0]?.path).toBe('projectId');
  });
});
