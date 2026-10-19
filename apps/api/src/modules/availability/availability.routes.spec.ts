// API tests: the real Express app over HTTP, with an in-memory repository instead of MongoDB.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { scheduleSchema } from './availability.schemas.js';
import { createFakeScheduleRepository, createTestClock, validRules } from './testing/fakes.js';

const SCHEDULE = '/api/v1/availability/schedule';
const KEYS = ['absences', 'exceptions', 'updatedAt', 'version', 'weekly'];

function setup() {
  const repository = createFakeScheduleRepository();
  const clock = createTestClock();
  const app = createTestApp({ clock, availability: { repository } });
  return { app, repository, clock };
}

function expectProblem(response: request.Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = problemSchema.parse(response.body);
  expect(problem.code).toBe(code);
  return problem;
}

const put = { ...validRules, version: 0 };

describe('GET /api/v1/availability/schedule', () => {
  it('answers 08:00-18:00 every day with version 0 and writes nothing', async () => {
    const { app, repository } = setup();

    const response = await request(app).get(SCHEDULE);

    expect(response.status).toBe(200);
    const body = scheduleSchema.parse(response.body);
    expect(body.weekly).toHaveLength(7);
    expect(body.weekly.every((day) => day.ranges.length === 1)).toBe(true);
    expect(body.weekly[6]?.ranges).toEqual([{ startMinute: 480, endMinute: 1080 }]);
    expect(body).toMatchObject({ exceptions: [], absences: [], version: 0, updatedAt: null });
    expect(repository.calls).toEqual(['find']);
    expect(repository.stored).toBeNull();
  });

  it('answers the stored schedule with exactly the declared keys and ISO dates', async () => {
    const { app, repository } = setup();
    repository.stored = { ...validRules, version: 3, updatedAt: new Date('2026-02-01T00:00:00Z') };

    const response = await request(app).get(SCHEDULE);

    expect(Object.keys(response.body as object).sort()).toEqual(KEYS);
    expect(response.body).toMatchObject({
      version: 3,
      updatedAt: '2026-02-01T00:00:00.000Z',
      exceptions: [{ date: '2026-12-25', ranges: [] }],
      absences: [{ from: '2026-12-28', to: '2027-01-03' }],
    });
  });

  it('answers a generic 503 when the repository fails', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('MongoNetworkError: boom');

    const problem = expectProblem(await request(app).get(SCHEDULE), 503, 'service_unavailable');
    expect(JSON.stringify(problem)).not.toContain('boom');
  });
});

describe('PUT /api/v1/availability/schedule', () => {
  it('creates the schedule with version 0 and answers 200 with version 1', async () => {
    const { app, clock } = setup();

    const response = await request(app).put(SCHEDULE).send(put);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...validRules,
      version: 1,
      updatedAt: clock.now().toISOString(),
    });
  });

  it('updates with the current version and bumps it', async () => {
    const { app, repository } = setup();
    repository.stored = { ...validRules, version: 1, updatedAt: new Date() };

    const response = await request(app)
      .put(SCHEDULE)
      .send({ ...put, exceptions: [], version: 1 });

    expect(response.body).toMatchObject({ version: 2, exceptions: [] });
  });

  it.each([
    ['a stale version', 1, 5],
    ['version 0 when a document exists', 0, 2],
  ])('answers 409 on version for %s and keeps the stored document', async (_l, sent, stored) => {
    const { app, repository } = setup();
    repository.stored = { ...validRules, version: stored, updatedAt: new Date() };
    const before = repository.stored;

    const response = await request(app)
      .put(SCHEDULE)
      .send({ ...put, version: sent });

    expect(expectProblem(response, 409, 'conflict').issues).toEqual([
      { path: 'version', message: 'Does not match the current version.' },
    ]);
    expect(repository.stored).toBe(before);
  });

  it('answers 409 for version 5 on an empty store', async () => {
    const { app, repository } = setup();

    expectProblem(
      await request(app)
        .put(SCHEDULE)
        .send({ ...put, version: 5 }),
      409,
      'conflict',
    );
    expect(repository.stored).toBeNull();
  });

  it.each([
    ['an unknown key', { ...put, _id: 'x' }],
    ['six weekly days', { ...put, weekly: put.weekly.slice(0, 6) }],
    [
      'an overlap',
      {
        ...put,
        weekly: [
          {
            ranges: [
              { startMinute: 0, endMinute: 100 },
              { startMinute: 50, endMinute: 200 },
            ],
          },
          ...put.weekly.slice(1),
        ],
      },
    ],
    ['a duplicate exception date', { ...put, exceptions: [put.exceptions[0], put.exceptions[0]] }],
    ['a missing version', { weekly: put.weekly, exceptions: put.exceptions, absences: [] }],
    ['a missing absences list', { weekly: put.weekly, exceptions: put.exceptions, version: 0 }],
    ['a reversed absence', { ...put, absences: [{ from: '2026-03-10', to: '2026-03-09' }] }],
  ])('answers 400 and writes nothing for %s', async (_label, payload) => {
    const { app, repository } = setup();

    expectProblem(await request(app).put(SCHEDULE).send(payload), 400, 'validation_failed');
    expect(repository.calls).toEqual([]);
  });

  it('reports the exact issue path of an invalid range', async () => {
    const { app } = setup();
    const weekly = put.weekly.map((day, i) =>
      i === 2
        ? {
            ranges: [
              { startMinute: 0, endMinute: 10 },
              { startMinute: 30, endMinute: 20 },
            ],
          }
        : day,
    );

    const problem = expectProblem(
      await request(app)
        .put(SCHEDULE)
        .send({ ...put, weekly }),
      400,
      'validation_failed',
    );

    expect(problem.issues?.map((issue) => issue.path)).toEqual(['weekly.2.ranges.1.endMinute']);
  });

  it('reports an overlapping absence on absences.1.from', async () => {
    const { app } = setup();
    const absences = [
      { from: '2026-03-10', to: '2026-03-12' },
      { from: '2026-03-12', to: '2026-03-15' },
    ];

    const problem = expectProblem(
      await request(app)
        .put(SCHEDULE)
        .send({ ...put, absences }),
      400,
      'validation_failed',
    );

    expect(problem.issues?.map((issue) => issue.path)).toEqual(['absences.1.from']);
  });

  it('reports 31 absences on the list itself', async () => {
    const { app } = setup();
    const absences = Array.from({ length: 31 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10);
      return { from: date, to: date };
    });

    const problem = expectProblem(
      await request(app)
        .put(SCHEDULE)
        .send({ ...put, absences }),
      400,
      'validation_failed',
    );

    expect(problem.issues?.map((issue) => issue.path)).toEqual(['absences']);
  });

  it('answers a generic 503 without driver text when the repository fails', async () => {
    const { app, repository } = setup();
    repository.failWith = new Error('MongoNetworkError: ECONNREFUSED');

    const problem = expectProblem(
      await request(app).put(SCHEDULE).send(put),
      503,
      'service_unavailable',
    );
    expect(JSON.stringify(problem)).not.toMatch(/Mongo|ECONNREFUSED/);
  });
});
