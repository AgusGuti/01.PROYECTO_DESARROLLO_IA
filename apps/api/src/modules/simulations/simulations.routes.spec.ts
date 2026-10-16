// API tests: the real Express app over HTTP, with in-memory ports.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { simulationSchema } from './simulations.schemas.js';
import {
  createFakePorts,
  PART_A,
  PRINTER_1,
  PRINTER_2,
  PROJECT_ID,
  type Failing,
} from './testing/fakes.js';

const URL = '/api/v1/simulations';
const KEYS = [
  'deadline',
  'goal',
  'jobs',
  'printers',
  'projectId',
  'startAt',
  'totals',
  'unplaced',
  'warnings',
];
const body = { projectId: PROJECT_ID, startAt: '2026-03-02T08:00' };

function setup() {
  const ports = createFakePorts();
  const app = createTestApp({ env: { RATE_LIMIT_MAX: '100000' }, simulations: ports });
  return { app, ports };
}

function expectProblem(response: request.Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = problemSchema.parse(response.body);
  expect(problem.code).toBe(code);
  return problem;
}

describe('POST /api/v1/simulations', () => {
  it('answers 200 with the timeline, the totals and only the declared fields', async () => {
    const { app, ports } = setup();
    ports.projects.set(PROJECT_ID, '2026-03-02');

    const response = await request(app).post(URL).send(body);

    expect(response.status).toBe(200);
    const dto = simulationSchema.parse(response.body);
    expect(Object.keys(response.body as object).sort()).toEqual(KEYS);
    expect(dto.jobs[0]).toEqual({
      order: 1,
      partId: PART_A,
      partName: 'Soporte en L',
      unit: 1,
      unitsInLine: 3,
      printerId: PRINTER_1,
      startAt: '2026-03-02T08:00',
      endAt: '2026-03-02T10:00',
      handoffAt: '2026-03-02T10:00',
      unattended: false,
    });
    expect(dto.printers).toEqual([
      { printerId: PRINTER_1, name: 'Ender 3', jobs: 3, busyMinutes: 360, idleMinutes: 0 },
    ]);
    expect(dto.totals).toEqual({
      placedJobs: 3,
      unplacedJobs: 0,
      finishAt: '2026-03-02T14:00',
      totalBusyMinutes: 360,
      totalIdleMinutes: 0,
    });
    expect(dto.deadline).toEqual({ date: '2026-03-02', met: true });
    expect(dto.goal).toBe('fastest');
    expect(dto.warnings).toEqual([]);
  });

  it('splits the work between two printers', async () => {
    const { app, ports } = setup();
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'multi',
      printerIds: [PRINTER_1, PRINTER_2],
      lines: [{ partId: PART_A, quantity: 4, completed: 0 }],
    });

    const dto = simulationSchema.parse((await request(app).post(URL).send(body)).body);

    expect(dto.jobs.map((job) => job.printerId)).toEqual([
      PRINTER_1,
      PRINTER_2,
      PRINTER_1,
      PRINTER_2,
    ]);
  });

  it('reports units beyond the 14-day horizon as unplaced', async () => {
    const { app, ports } = setup();
    ports.parts.set(PART_A, { name: 'Soporte en L', estimatedPrintSeconds: 36_000 });
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [{ partId: PART_A, quantity: 20, completed: 0 }],
    });
    ports.projects.set(PROJECT_ID, '2030-01-01');

    const dto = simulationSchema.parse((await request(app).post(URL).send(body)).body);

    expect(dto.totals).toMatchObject({ placedJobs: 15, unplacedJobs: 5 });
    expect(dto.unplaced).toEqual([{ partId: PART_A, partName: 'Soporte en L', units: 5 }]);
    expect(dto.deadline.met).toBe(false);
  });

  it('writes nothing: the same request twice gives the same answer', async () => {
    const { app } = setup();

    const first = await request(app).post(URL).send(body);
    const second = await request(app).post(URL).send(body);

    expect(second.body).toEqual(first.body);
  });

  it.each([
    ['a body that is not an object', []],
    ['an unknown field', { ...body, extra: 1 }],
    ['seconds in startAt', { ...body, startAt: '2026-03-02T08:00:00' }],
    ['a zone suffix', { ...body, startAt: '2026-03-02T08:00Z' }],
    ['an impossible date', { ...body, startAt: '2026-02-30T08:00' }],
    ['a malformed id', { ...body, projectId: 'nope' }],
    ['a missing startAt', { projectId: PROJECT_ID }],
  ])('answers 400 for %s', async (_label, payload) => {
    const { app } = setup();

    expectProblem(await request(app).post(URL).send(payload), 400, 'validation_failed');
  });

  it('answers 400 on projectId when the project has no queue', async () => {
    const { app, ports } = setup();
    ports.queues.clear();

    const problem = expectProblem(
      await request(app).post(URL).send(body),
      400,
      'validation_failed',
    );

    expect(problem.issues).toEqual([{ path: 'projectId', message: 'The project has no queue.' }]);
  });

  it('answers 400 on projectId for an unknown project id', async () => {
    const { app } = setup();

    const problem = expectProblem(
      await request(app)
        .post(URL)
        .send({ ...body, projectId: '9'.repeat(24) }),
      400,
      'validation_failed',
    );

    expect(problem.issues?.[0]?.path).toBe('projectId');
  });

  it.each(['queue', 'project', 'parts', 'printers', 'schedule'] as Failing[])(
    'answers a generic 503 when the %s port fails',
    async (which) => {
      const { app, ports } = setup();
      ports.failing = which;

      const response = await request(app).post(URL).send(body);

      expectProblem(response, 503, 'service_unavailable');
      expect(JSON.stringify(response.body)).not.toContain('boom');
    },
  );
});
