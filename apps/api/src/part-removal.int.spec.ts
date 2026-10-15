// Integration test of the real wiring in app.ts (ADR 0017, 0018): real repositories, real part
// lookup and real usage port. A structural mismatch between `parts` and `projects` would show
// up only here, because the module tests use fakes.
import type { Express } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from './infrastructure/database/mongo.js';
import type { Clock } from './modules/health/index.js';
import { createMongoPartRepository } from './modules/parts/index.js';
import { AppError } from './shared/errors/app-error.js';
import { createTestApp, testConfig } from './testing/test-app.js';

const partBody = (name: string) => ({
  name,
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: 5700,
  layerHeightUm: 200,
});

describe('removing a part that projects use, on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  let app: Express;
  let current = new Date('2026-03-01T10:00:00.000Z');
  const clock: Clock = { now: () => new Date(current) };
  // Wraps the real parts repository so a test can make the soft delete fail once.
  const realParts = createMongoPartRepository();
  let failSoftDelete = false;

  const projects = () => mongoose.connection.collection('projects');
  const parts = () => mongoose.connection.collection('parts');
  const rawProject = (id: string) => projects().findOne({ _id: new mongoose.Types.ObjectId(id) });
  const rawPart = (id: string) => parts().findOne({ _id: new mongoose.Types.ObjectId(id) });

  const createPart = async (name: string): Promise<string> =>
    ((await request(app).post('/api/v1/parts').send(partBody(name))).body as { id: string }).id;
  const createProject = async (name: string, items: unknown[]): Promise<string> =>
    ((await request(app).post('/api/v1/projects').send({ name, items })).body as { id: string }).id;
  const del = (id: string, flag?: string) =>
    request(app)
      .delete(`/api/v1/parts/${id}`)
      .query(flag === undefined ? {} : { removeFromProjects: flag });

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
    app = createTestApp({
      database,
      clock,
      env: { RATE_LIMIT_MAX: '100000' },
      parts: {
        repository: {
          ...realParts,
          softDelete: (id, now) =>
            failSoftDelete
              ? Promise.reject(
                  new AppError('service_unavailable', 'The part data is temporarily unavailable.'),
                )
              : realParts.softDelete(id, now),
        },
      },
    });
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await projects().deleteMany({});
    await parts().deleteMany({});
    failSoftDelete = false;
    current = new Date('2026-03-01T10:00:00.000Z');
  });

  /** A part used by two live projects and one soft-deleted project. */
  async function scenario() {
    const part = await createPart('Soporte de estante en L');
    const other = await createPart('Florero espiral');
    const alpha = await createProject('Alfa', [
      { partId: part, quantity: 6 },
      { partId: other, quantity: 1 },
    ]);
    const beta = await createProject('Beta', [{ partId: part, quantity: 2 }]);
    const gone = await createProject('Borrado', [{ partId: part, quantity: 9 }]);
    await request(app).delete(`/api/v1/projects/${gone}`);
    current = new Date('2026-03-01T12:00:00.000Z');
    return { part, other, alpha, beta, gone };
  }

  it('answers 409 without the flag and changes nothing', async () => {
    const { part, alpha, beta } = await scenario();
    const before = [await rawProject(alpha), await rawProject(beta), await rawPart(part)];

    const response = await del(part);

    expect(response.status).toBe(409);
    const body = response.body as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'conflict',
      detail: 'The part is used by one or more projects.',
      issues: [{ path: 'projects', message: 'Remove the part from the projects first.' }],
    });
    // Only the usual problem fields: no project names, ids or counts hide in extra keys.
    expect(Object.keys(body).sort()).toEqual(
      ['code', 'detail', 'instance', 'issues', 'requestId', 'status', 'title', 'type'].filter(
        (key) => key in body,
      ),
    );
    expect(JSON.stringify(body)).not.toMatch(/Alfa|Beta|Borrado/);
    expect([await rawProject(alpha), await rawProject(beta), await rawPart(part)]).toEqual(before);
  });

  it('reports the live projects that use the part, sorted by name, ignoring the deleted one', async () => {
    const { part, alpha, beta } = await scenario();

    const response = await request(app).get(`/api/v1/parts/${part}/usage`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 2,
      projects: [
        { id: alpha, name: 'Alfa', quantity: 6 },
        { id: beta, name: 'Beta', quantity: 2 },
      ],
    });
  });

  it('with the flag answers 204, pulls the lines from live projects only and removes the part', async () => {
    const { part, other, alpha, beta, gone } = await scenario();
    const goneBefore = await rawProject(gone);

    const response = await del(part, 'true');

    expect(response.status).toBe(204);
    expect(await rawProject(alpha)).toMatchObject({
      items: [{ partId: new mongoose.Types.ObjectId(other), quantity: 1 }],
      version: 2,
      updatedAt: current,
    });
    expect(await rawProject(beta)).toMatchObject({ items: [], version: 2, updatedAt: current });
    expect(await rawProject(gone)).toEqual(goneBefore);
    expect((await request(app).get(`/api/v1/parts/${part}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/parts/${part}/usage`)).status).toBe(404);
  });

  it('makes a stale editor get 409 on version after the cascade', async () => {
    const { part, alpha } = await scenario();
    await del(part, 'true');

    const response = await request(app)
      .patch(`/api/v1/projects/${alpha}`)
      .send({ version: 1, name: 'Editado' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ issues: [{ path: 'version' }] });
  });

  it('keeps the part live with its lines already pulled when the delete fails, and a retry works', async () => {
    const { part, alpha, beta } = await scenario();
    failSoftDelete = true;

    const failed = await del(part, 'true');

    expect(failed.status).toBe(503);
    expect((await rawPart(part))?.['deletedAt']).toBeNull();
    expect((await rawProject(alpha))?.['items']).toHaveLength(1);
    expect((await rawProject(beta))?.['items']).toEqual([]);

    failSoftDelete = false;
    const retry = await del(part, 'true');

    expect(retry.status).toBe(204);
    expect((await rawPart(part))?.['deletedAt']).toBeInstanceOf(Date);
    // The retry found nothing left to pull: the projects were not bumped a second time.
    expect(await rawProject(beta)).toMatchObject({ version: 2 });
  });

  it('a plain delete of an unused part works, and so does the flag on an unused part', async () => {
    const plain = await createPart('Sin uso');
    const flagged = await createPart('Sin uso tampoco');

    expect((await del(plain)).status).toBe(204);
    expect((await del(flagged, 'true')).status).toBe(204);
    // Both are removed logically, not just answered with 204.
    for (const id of [plain, flagged]) {
      expect(await rawPart(id)).toMatchObject({ deletedAt: expect.any(Date) });
      expect((await request(app).get(`/api/v1/parts/${id}`)).status).toBe(404);
    }
  });

  it('shows part null for a line that points to a part deleted by a racing request', async () => {
    const part = await createPart('Carrera');
    const project = await createProject('Con carrera', [{ partId: part, quantity: 3 }]);
    // The residual race of ADR 0018: the part is gone, the line is still there.
    await parts().updateOne(
      { _id: new mongoose.Types.ObjectId(part) },
      { $set: { deletedAt: new Date() } },
    );

    const response = await request(app).get(`/api/v1/projects/${project}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ items: [{ partId: part, quantity: 3, part: null }] });
  });

  it('leaves only the _id index on projects', async () => {
    await createProject('Indices', []);

    const indexes = await projects().indexes();

    expect(indexes.map((index) => index.name)).toEqual(['_id_']);
  });
});
