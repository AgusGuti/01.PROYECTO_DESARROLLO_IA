// API tests: the real Express app over HTTP, with in-memory repository and ports.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { queueSchema } from './queues.schemas.js';
import {
  createFakePorts,
  createFakeQueueRepository,
  createTestClock,
  line,
  PART_A,
  PART_B,
  PART_C,
  PRINTER_1,
  PRINTER_2,
  PROJECT_ID,
  SPOOL_1,
  SPOOL_2,
} from './testing/fakes.js';

const QUEUES = '/api/v1/queues';
const ONE = `${QUEUES}/${PROJECT_ID}`;
const KEYS = [
  'createdAt',
  'goal',
  'lines',
  'mode',
  'printerIds',
  'projectId',
  'totals',
  'updatedAt',
  'version',
];

function setup() {
  const repository = createFakeQueueRepository();
  const ports = createFakePorts();
  const app = createTestApp({
    clock: createTestClock(),
    env: { RATE_LIMIT_MAX: '100000' },
    queues: { repository, ...ports },
  });
  return { app, repository, ports };
}

function expectProblem(response: request.Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = problemSchema.parse(response.body);
  expect(problem.code).toBe(code);
  return problem;
}

const body = { projectId: PROJECT_ID, goal: 'fastest', mode: 'single', printerIds: [PRINTER_1] };

describe('POST /api/v1/queues', () => {
  it('creates a queue from the project lines and answers 201 with Location and totals', async () => {
    const { app } = setup();

    const response = await request(app).post(QUEUES).send(body);

    expect(response.status).toBe(201);
    expect(response.headers['location']).toBe(ONE);
    const dto = queueSchema.parse(response.body);
    expect(Object.keys(response.body as object).sort()).toEqual(KEYS);
    expect(dto.lines[0]).toMatchObject({ partId: PART_A, partName: 'Soporte en L', completed: 0 });
    // The spools of the project lines are copied and shown as they are now.
    expect(dto.lines[0]).toMatchObject({
      filamentId: SPOOL_1,
      filament: { brand: 'Grilon3', material: 'PETG', colorName: 'Negro', availableGrams: 800 },
      filamentDeleted: false,
    });
    expect(dto.lines[1]?.filamentId).toBe(SPOOL_2);
    expect(Object.keys(dto.lines[0] ?? {}).sort()).toEqual([
      'completed',
      'estimatedPrintSeconds',
      'filament',
      'filamentDeleted',
      'filamentId',
      'partDeleted',
      'partId',
      'partName',
      'pendingUnits',
      'quantity',
    ]);
    expect(dto.totals.pendingSeconds).toBe(15_600);
    expect(dto.version).toBe(1);
  });

  it('answers 400 on lines.1.filamentId when a project line has no spool', async () => {
    const { app, ports, repository } = setup();
    ports.projects.set(PROJECT_ID, [
      { partId: PART_A, filamentId: SPOOL_1, quantity: 1 },
      { partId: PART_A, filamentId: null, quantity: 1 },
    ]);

    const problem = expectProblem(
      await request(app).post(QUEUES).send(body),
      400,
      'validation_failed',
    );

    expect(problem.issues).toEqual([
      { path: 'lines.1.filamentId', message: 'Assign a spool to this line in the project first.' },
    ]);
    expect(repository.stored.size).toBe(0);
  });

  it.each([
    ['a null spool', [{ partId: PART_A, filamentId: null, quantity: 1 }], 'lines.0.filamentId'],
    ['no spool', [{ partId: PART_A, quantity: 1 }], 'lines.0.filamentId'],
    [
      'printed pieces',
      [{ partId: PART_A, filamentId: SPOOL_1, quantity: 2, completed: 1 }],
      'lines.0.completed',
    ],
    [
      'a repeated part and spool',
      [
        { partId: PART_A, filamentId: SPOOL_1, quantity: 1 },
        { partId: PART_A, filamentId: SPOOL_1, quantity: 1 },
      ],
      'lines.1.filamentId',
    ],
  ])('answers 400 on %s in the given lines', async (_label, lines, path) => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(QUEUES)
      .send({ ...body, lines });

    expect(expectProblem(response, 400, 'validation_failed').issues?.map((i) => i.path)).toEqual([
      path,
    ]);
    expect(repository.stored.size).toBe(0);
  });

  it('answers 400 on the second line when only it has printed pieces, even if fully printed', async () => {
    const { app, repository } = setup();

    const response = await request(app)
      .post(QUEUES)
      .send({
        ...body,
        lines: [
          { partId: PART_A, filamentId: SPOOL_1, quantity: 2 },
          { partId: PART_B, filamentId: SPOOL_2, quantity: 2, completed: 2 },
        ],
      });

    expect(expectProblem(response, 400, 'validation_failed').issues?.map((i) => i.path)).toEqual([
      'lines.1.completed',
    ]);
    expect(repository.stored.size).toBe(0);
  });

  it('starts every line at completed 0 when the lines are copied from the project', async () => {
    const { app } = setup();

    const response = await request(app).post(QUEUES).send(body);

    expect(response.status).toBe(201);
    const dto = queueSchema.parse(response.body);
    expect(dto.lines.map((l) => [l.completed, l.pendingUnits === l.quantity])).toEqual([
      [0, true],
      [0, true],
    ]);
    expect(dto.totals.completedUnits).toBe(0);
  });

  it('answers 400 listing every problem at once with indexed paths', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(QUEUES)
      .send({
        ...body,
        projectId: '9'.repeat(24),
        lines: [{ partId: PART_C, filamentId: SPOOL_1, quantity: 1 }],
      });

    expect(expectProblem(response, 400, 'validation_failed').issues?.map((i) => i.path)).toEqual([
      'projectId',
      'lines.0.partId',
    ]);
  });

  it.each([
    ['an unknown field', { ...body, version: 1 }],
    ['a wrong printer count', { ...body, mode: 'multi' }],
    ['a body that is not an object', []],
  ])('answers 400 for %s', async (_label, payload) => {
    const { app, repository } = setup();

    expectProblem(await request(app).post(QUEUES).send(payload), 400, 'validation_failed');
    expect(repository.stored.size).toBe(0);
  });

  it('answers 409 on projectId when the project already has a queue', async () => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID);

    const problem = expectProblem(await request(app).post(QUEUES).send(body), 409, 'conflict');

    expect(problem.issues?.[0]?.path).toBe('projectId');
  });

  it('answers a generic 503 when a port fails', async () => {
    const { app, ports } = setup();
    ports.failing = 'parts';

    const problem = expectProblem(
      await request(app).post(QUEUES).send(body),
      503,
      'service_unavailable',
    );

    expect(JSON.stringify(problem)).not.toContain('boom');
  });
});

describe('GET /api/v1/queues/:projectId', () => {
  it('answers the queue with enriched lines and totals', async () => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID, {
      goal: 'deadline',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [line(PART_A, 4, 1), line(PART_C, 2)],
    });

    const response = await request(app).get(ONE);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      lines: [
        {
          partId: PART_A,
          partName: 'Soporte en L',
          estimatedPrintSeconds: 3600,
          pendingUnits: 3,
          partDeleted: false,
        },
        {
          partId: PART_C,
          partName: null,
          estimatedPrintSeconds: null,
          pendingUnits: 2,
          partDeleted: true,
        },
      ],
      totals: { totalUnits: 6, completedUnits: 1, pendingUnits: 5, pendingSeconds: 10_800 },
    });
  });

  it('answers 404 when there is no queue and 400 for a malformed id', async () => {
    const { app } = setup();

    expectProblem(await request(app).get(ONE), 404, 'not_found');
    expectProblem(await request(app).get(`${QUEUES}/nope`), 400, 'validation_failed');
  });

  it('answers 503 when the parts port fails', async () => {
    const { app, repository, ports } = setup();
    repository.seed(PROJECT_ID);
    ports.failing = 'parts';

    expectProblem(await request(app).get(ONE), 503, 'service_unavailable');
  });

  it('answers a generic 503 when the repository fails', async () => {
    const { app, repository } = setup();
    repository.failWith = new AppError(
      'service_unavailable',
      'The queue data is temporarily unavailable.',
    );

    expectProblem(await request(app).get(ONE), 503, 'service_unavailable');
  });
});

describe('PATCH /api/v1/queues/:projectId', () => {
  it('edits and bumps the version', async () => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID);

    const response = await request(app)
      .patch(ONE)
      .send({ version: 1, mode: 'multi', printerIds: [PRINTER_1, PRINTER_2] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      mode: 'multi',
      printerIds: [PRINTER_1, PRINTER_2],
      version: 2,
    });
  });

  it('answers 400 (schema) before 404', async () => {
    const { app } = setup();

    expectProblem(
      await request(app).patch(ONE).send({ goal: 'fastest' }),
      400,
      'validation_failed',
    );
  });

  it('answers 404, then 409 for a stale version, then a domain 400 for the merged result', async () => {
    const { app, repository } = setup();

    expectProblem(
      await request(app).patch(ONE).send({ version: 1, goal: 'deadline' }),
      404,
      'not_found',
    );
    repository.seed(PROJECT_ID);
    expectProblem(
      await request(app).patch(ONE).send({ version: 7, mode: 'multi' }),
      409,
      'conflict',
    );
    expectProblem(
      await request(app).patch(ONE).send({ version: 1, mode: 'multi' }),
      400,
      'validation_failed',
    );
    expect(repository.stored.get(PROJECT_ID)?.version).toBe(1);
  });
});

describe('PATCH lines and spools', () => {
  const seeded = {
    goal: 'fastest',
    mode: 'single',
    printerIds: [PRINTER_1],
    lines: [line(PART_A, 4, 2, SPOOL_1)],
  } as const;
  const wire = (
    partId: string,
    filamentId: string | null,
    quantity: number,
    completed: number,
  ) => ({
    partId,
    filamentId,
    quantity,
    completed,
  });

  it('splits a printed line through the same PATCH', async () => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID, seeded);

    const response = await request(app)
      .patch(ONE)
      .send({ version: 1, lines: [wire(PART_A, SPOOL_1, 2, 2), wire(PART_A, SPOOL_2, 2, 0)] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      version: 2,
      lines: [
        { filamentId: SPOOL_1, quantity: 2, completed: 2, pendingUnits: 0 },
        { filamentId: SPOOL_2, quantity: 2, completed: 0, pendingUnits: 2 },
      ],
    });
  });

  it('answers 400 on lines when a printed line changes its spool', async () => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID, seeded);

    const response = await request(app)
      .patch(ONE)
      .send({ version: 1, lines: [wire(PART_A, SPOOL_2, 4, 2)] });

    expect(expectProblem(response, 400, 'validation_failed').issues?.[0]?.path).toBe('lines');
  });

  it('answers 400 on lines.0.filamentId for a null spool and for a deleted spool', async () => {
    const { app, repository, ports } = setup();
    repository.seed(PROJECT_ID, { ...seeded, lines: [line(PART_A, 4, 0)] });

    const missing = await request(app)
      .patch(ONE)
      .send({ version: 1, lines: [wire(PART_A, null, 4, 0)] });
    ports.filaments.delete(SPOOL_2);
    const gone = await request(app)
      .patch(ONE)
      .send({ version: 1, lines: [wire(PART_A, SPOOL_2, 4, 0)] });

    expect(expectProblem(missing, 400, 'validation_failed').issues?.[0]?.path).toBe(
      'lines.0.filamentId',
    );
    expect(expectProblem(gone, 400, 'validation_failed').issues).toEqual([
      { path: 'lines.0.filamentId', message: 'The spool does not exist.' },
    ]);
  });

  it('answers 503 when the spool lookup fails', async () => {
    const { app, repository, ports } = setup();
    repository.seed(PROJECT_ID, { ...seeded, lines: [line(PART_A, 4, 0)] });
    ports.failing = 'filaments';

    expectProblem(
      await request(app)
        .patch(ONE)
        .send({ version: 1, lines: [wire(PART_A, SPOOL_1, 4, 0)] }),
      503,
      'service_unavailable',
    );
  });

  it('shows a line whose spool is gone with filament null and filamentDeleted, and a legacy line without', async () => {
    const { app, repository, ports } = setup();
    repository.seed(PROJECT_ID, {
      ...seeded,
      lines: [line(PART_A, 4, 0, SPOOL_1), line(PART_B, 1, 0, null)],
    });
    ports.filaments.delete(SPOOL_1);

    const response = await request(app).get(ONE);

    expect(response.body).toMatchObject({
      lines: [
        { filamentId: SPOOL_1, filament: null, filamentDeleted: true },
        { filamentId: null, filament: null, filamentDeleted: false },
      ],
    });
  });
});

describe('PATCH with a deleted part', () => {
  it('accepts completed and quantity changes on it, rejects a new missing part and a line without completed', async () => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID, {
      goal: 'fastest',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [line(PART_C, 2)],
    });

    const ok = await request(app)
      .patch(ONE)
      .send({
        version: 1,
        lines: [{ partId: PART_C, filamentId: SPOOL_1, quantity: 6, completed: 4 }],
      });
    const added = await request(app)
      .patch(ONE)
      .send({
        version: 2,
        lines: [
          { partId: PART_C, filamentId: SPOOL_1, quantity: 6, completed: 4 },
          { partId: '9'.repeat(24), filamentId: SPOOL_1, quantity: 1, completed: 0 },
        ],
      });
    const noCompleted = await request(app)
      .patch(ONE)
      .send({ version: 2, lines: [{ partId: PART_C, quantity: 6 }] });

    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      version: 2,
      lines: [{ quantity: 6, completed: 4, partDeleted: true }],
    });
    expect(added.status).toBe(400);
    expect(noCompleted.status).toBe(400);
  });
});

describe('DELETE /api/v1/queues/:projectId', () => {
  it('answers 204 and removes the queue', async () => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID);

    const response = await request(app).delete(ONE).query({ version: 1 });

    expect(response.status).toBe(204);
    expect(repository.stored.size).toBe(0);
  });

  it.each([
    ['no version', {}],
    ['version 0', { version: '0' }],
    ['an unknown query key', { version: '1', force: 'true' }],
  ])('answers 400 for %s', async (_label, query) => {
    const { app, repository } = setup();
    repository.seed(PROJECT_ID);

    expectProblem(await request(app).delete(ONE).query(query), 400, 'validation_failed');
    expect(repository.stored.size).toBe(1);
  });

  it('answers 409 for a stale version and 404 when there is no queue', async () => {
    const { app, repository } = setup();

    expectProblem(await request(app).delete(ONE).query({ version: 1 }), 404, 'not_found');
    repository.seed(PROJECT_ID);
    expectProblem(await request(app).delete(ONE).query({ version: 2 }), 409, 'conflict');
    expect(repository.stored.size).toBe(1);
  });
});
