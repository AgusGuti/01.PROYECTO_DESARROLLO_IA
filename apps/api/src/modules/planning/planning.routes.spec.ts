// API tests: the real Express app over HTTP, with an in-memory settings repository.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { planningSettingsSchema } from './planning.schemas.js';
import { createFakeSettingsRepository, createTestClock, validRates } from './testing/fakes.js';

const SETTINGS = '/api/v1/planning/settings';
const KEYS = ['batchSavingBasisPoints', 'updatedAt', 'version'];

function setup() {
  const repository = createFakeSettingsRepository();
  const app = createTestApp({
    clock: createTestClock(),
    env: { RATE_LIMIT_MAX: '100000' },
    planning: { repository },
  });
  return { app, repository };
}

function expectProblem(response: request.Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = problemSchema.parse(response.body);
  expect(problem.code).toBe(code);
  return problem;
}

describe('GET /api/v1/planning/settings', () => {
  it('answers the defaults at version 0 and writes nothing', async () => {
    const { app, repository } = setup();

    const response = await request(app).get(SETTINGS);

    expect(response.status).toBe(200);
    expect(planningSettingsSchema.parse(response.body)).toEqual({
      batchSavingBasisPoints: 0,
      version: 0,
      updatedAt: null,
    });
    expect(repository.stored).toBeNull();
  });

  it('answers the stored settings with exactly the declared keys', async () => {
    const { app, repository } = setup();
    repository.stored = { ...validRates, version: 3, updatedAt: new Date('2026-02-01T00:00:00Z') };

    const response = await request(app).get(SETTINGS);

    expect(Object.keys(response.body as object).sort()).toEqual(KEYS);
    expect(response.body).toEqual({
      batchSavingBasisPoints: 1500,
      version: 3,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('answers a generic 503 when the repository fails', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('MongoNetworkError: boom');

    const response = await request(app).get(SETTINGS);

    expectProblem(response, 503, 'service_unavailable');
    expect(JSON.stringify(response.body)).not.toContain('boom');
  });
});

describe('PUT /api/v1/planning/settings', () => {
  it('creates the settings with version 0 and answers 200 with version 1', async () => {
    const { app } = setup();

    const response = await request(app)
      .put(SETTINGS)
      .send({ ...validRates, version: 0 });

    expect(response.status).toBe(200);
    expect(planningSettingsSchema.parse(response.body)).toMatchObject({
      batchSavingBasisPoints: 1500,
      version: 1,
      updatedAt: '2026-03-01T10:00:00.000Z',
    });
  });

  it('updates with the version last seen', async () => {
    const { app, repository } = setup();
    repository.stored = { ...validRates, version: 1, updatedAt: new Date() };

    const response = await request(app)
      .put(SETTINGS)
      .send({ batchSavingBasisPoints: 5000, version: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ batchSavingBasisPoints: 5000, version: 2 });
  });

  it('answers 409 on version for a stale version and keeps the stored data', async () => {
    const { app, repository } = setup();
    repository.stored = { ...validRates, version: 3, updatedAt: new Date() };

    const problem = expectProblem(
      await request(app).put(SETTINGS).send({ batchSavingBasisPoints: 1, version: 2 }),
      409,
      'conflict',
    );

    expect(problem.issues?.[0]?.path).toBe('version');
    expect(repository.stored.batchSavingBasisPoints).toBe(1500);
  });

  it.each([
    ['a value above 5000', { batchSavingBasisPoints: 5001, version: 0 }],
    ['a negative value', { batchSavingBasisPoints: -1, version: 0 }],
    ['a float', { batchSavingBasisPoints: 10.5, version: 0 }],
    ['a missing version', { batchSavingBasisPoints: 10 }],
    ['an unknown field', { batchSavingBasisPoints: 10, version: 0, _id: 'x' }],
    ['a body that is not an object', []],
  ])('answers 400 for %s and writes nothing', async (_label, payload) => {
    const { app, repository } = setup();

    expectProblem(await request(app).put(SETTINGS).send(payload), 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('answers a generic 503 when the repository fails', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('MongoNetworkError: ECONNREFUSED');

    const response = await request(app)
      .put(SETTINGS)
      .send({ ...validRates, version: 0 });

    expectProblem(response, 503, 'service_unavailable');
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
  });
});
