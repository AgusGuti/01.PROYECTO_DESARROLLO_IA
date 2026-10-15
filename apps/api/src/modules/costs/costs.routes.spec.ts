// API tests: the real Express app over HTTP, with in-memory fakes instead of MongoDB.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import {
  costEstimateSchema,
  costSettingsSchema,
  projectCostEstimateSchema,
} from './costs.schemas.js';
import {
  createFakes,
  createTestClock,
  filamentData,
  FILAMENT_ID,
  OTHER_ID,
  PART_ID,
  partData,
  PRINTER_ID,
  validRates,
} from './testing/fakes.js';

const ESTIMATES = '/api/v1/costs/estimates';
const SETTINGS = '/api/v1/costs/settings';
const PROJECTS = '/api/v1/costs/project-estimates';

const ESTIMATE_KEYS = [
  'electricity',
  'filament',
  'fixed',
  'marginBasisPoints',
  'marginMinor',
  'printSeconds',
  'quantity',
  'subtotalMinor',
  'totalMinor',
  'unitTotalMinor',
  'warnings',
  'wear',
];
const SETTINGS_KEYS = [
  'defaultMarginBasisPoints',
  'fixedPerJobMinor',
  'kwhPriceMinor',
  'updatedAt',
  'version',
  'wearPerHourMinor',
];

function setup() {
  const fakes = createFakes();
  const clock = createTestClock();
  const app = createTestApp({
    clock,
    env: { RATE_LIMIT_MAX: '100000' },
    costs: {
      repository: fakes.settings,
      partReader: fakes.parts.read,
      filamentReader: fakes.filaments.read,
      printerReader: fakes.printers.read,
    },
  });
  return { app, clock, ...fakes };
}

function expectProblem(
  response: request.Response,
  status: number,
  code: string,
): ReturnType<typeof problemSchema.parse> {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = problemSchema.parse(response.body);
  expect(problem.code).toBe(code);
  return problem;
}

const body = { partId: PART_ID, filamentId: FILAMENT_ID, printerId: PRINTER_ID };
const saved = { ...validRates, version: 3, updatedAt: new Date('2026-02-01T00:00:00.000Z') };

describe('POST /api/v1/costs/estimates', () => {
  it('answers 200 with the worked example and writes nothing', async () => {
    const { app, settings } = setup();
    settings.stored = { ...saved, version: 1 };

    const response = await request(app)
      .post(ESTIMATES)
      .send({ ...body, quantity: 2, marginBasisPoints: 2500 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      quantity: 2,
      printSeconds: 14_400,
      filament: { grams: 200, costMinor: 400_000 },
      electricity: { watts: 270, costMinor: 8640 },
      wear: { costMinor: 600 },
      fixed: { costMinor: 5000 },
      subtotalMinor: 414_240,
      marginBasisPoints: 2500,
      marginMinor: 103_560,
      totalMinor: 517_800,
      unitTotalMinor: 258_900,
      warnings: [],
    });
    costEstimateSchema.parse(response.body);
    expect(settings.calls).toEqual(['find']);
  });

  it('exposes exactly the declared keys and no internal field', async () => {
    const { app } = setup();

    const response = await request(app).post(ESTIMATES).send(body);

    expect(Object.keys(response.body as object).sort()).toEqual(ESTIMATE_KEYS);
    const text = JSON.stringify(response.body);
    for (const leak of ['_id', 'deletedAt', 'version', 'initialGrams', 'purchaseCostMinor']) {
      expect(text).not.toContain(leak);
    }
  });

  it('adds no margin without marginBasisPoints even when a default margin is saved', async () => {
    const { app, settings } = setup();
    settings.stored = { ...saved, defaultMarginBasisPoints: 5000 };

    const response = await request(app).post(ESTIMATES).send(body);

    expect(response.body).toMatchObject({ marginBasisPoints: 0, marginMinor: 0 });
  });

  it('defaults the quantity to 1', async () => {
    const { app } = setup();

    const response = await request(app).post(ESTIMATES).send(body);

    expect(response.body).toMatchObject({ quantity: 1, printSeconds: 7200 });
  });

  it('names the warning codes and omits electricity without a printer', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(ESTIMATES)
      .send({ partId: PART_ID, filamentId: FILAMENT_ID });

    expect(response.body).toMatchObject({
      electricity: null,
      warnings: [{ code: 'electricity_printer_not_selected' }, { code: 'settings_not_configured' }],
    });
  });

  it('accepts a printer without power and warns', async () => {
    const { app, printers } = setup();
    printers.records.set(PRINTER_ID, { id: PRINTER_ID, powerWatts: null });

    const response = await request(app).post(ESTIMATES).send(body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      electricity: null,
      warnings: expect.arrayContaining([{ code: 'electricity_printer_power_unknown' }]),
    });
  });

  it('reports every missing reference in one 400', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(ESTIMATES)
      .send({ partId: OTHER_ID, filamentId: OTHER_ID, printerId: OTHER_ID });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.map((issue) => issue.path)).toEqual([
      'partId',
      'filamentId',
      'printerId',
    ]);
  });

  it('answers 400 on filamentId when the materials differ', async () => {
    const { app, filaments } = setup();
    filaments.records.set(FILAMENT_ID, {
      id: FILAMENT_ID,
      material: 'PLA',
      initialGrams: 1000,
      availableGrams: 1000,
      purchaseCostMinor: 1,
    });

    const response = await request(app).post(ESTIMATES).send(body);

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([
      { path: 'filamentId', message: 'The spool material differs from the part material.' },
    ]);
  });

  it('answers 400 on quantity when the amounts overflow', async () => {
    const { app, parts, filaments } = setup();
    parts.records.set(PART_ID, {
      id: PART_ID,
      material: 'PETG',
      estimatedWeightGrams: 20_000,
      estimatedPrintSeconds: 60,
    });
    filaments.records.set(FILAMENT_ID, {
      id: FILAMENT_ID,
      material: 'PETG',
      initialGrams: 1,
      availableGrams: 1,
      purchaseCostMinor: 1_000_000_000,
    });

    const response = await request(app)
      .post(ESTIMATES)
      .send({ ...body, quantity: 1000 });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.map((issue) => issue.path)).toEqual(['quantity']);
  });

  it.each([
    ['an unknown key', { ...body, totalMinor: 1 }],
    ['a quantity of 0', { ...body, quantity: 0 }],
    ['a quantity of 1001', { ...body, quantity: 1001 }],
    ['a fractional quantity', { ...body, quantity: 1.5 }],
    ['a negative margin', { ...body, marginBasisPoints: -1 }],
    ['a margin above the cap', { ...body, marginBasisPoints: 100_001 }],
    ['a textual margin', { ...body, marginBasisPoints: '10' }],
    ['a malformed part id', { ...body, partId: 'nope' }],
    ['no body fields', {}],
  ])('answers 400 and reads nothing for %s', async (_label, payload) => {
    const { app, parts, filaments, printers, settings } = setup();

    const response = await request(app).post(ESTIMATES).send(payload);

    expectProblem(response, 400, 'validation_failed');
    expect([parts.calls, filaments.calls, printers.calls, settings.calls]).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });

  it.each(['parts', 'filaments', 'printers', 'settings'] as const)(
    'answers a generic 503 without driver text when the %s dependency fails',
    async (name) => {
      const fakes = setup();
      fakes[name].failWith = new Error('MongoServerSelectionError: ECONNREFUSED 10.1.2.3:27017');

      const response = await request(fakes.app).post(ESTIMATES).send(body);

      const problem = expectProblem(response, 503, 'service_unavailable');
      expect(JSON.stringify(problem)).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|Mongo/);
      expect(fakes.settings.stored).toBeNull();
    },
  );

  it('answers a 503 when the settings repository raises an AppError', async () => {
    const { app, settings } = setup();
    settings.failWith = new AppError(
      'service_unavailable',
      'The cost settings are temporarily unavailable.',
    );

    expectProblem(await request(app).post(ESTIMATES).send(body), 503, 'service_unavailable');
  });
});

describe('GET /api/v1/costs/settings', () => {
  it('answers the defaults with version 0 and writes nothing', async () => {
    const { app, settings } = setup();

    const response = await request(app).get(SETTINGS);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      kwhPriceMinor: 0,
      wearPerHourMinor: 0,
      fixedPerJobMinor: 0,
      defaultMarginBasisPoints: 0,
      version: 0,
      updatedAt: null,
    });
    expect(settings.calls).toEqual(['find']);
    expect(settings.stored).toBeNull();
  });

  it('answers the stored settings with exactly the declared keys', async () => {
    const { app, settings } = setup();
    settings.stored = saved;

    const response = await request(app).get(SETTINGS);

    expect(response.body).toEqual({
      ...validRates,
      version: 3,
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
    expect(Object.keys(response.body as object).sort()).toEqual(SETTINGS_KEYS);
    costSettingsSchema.parse(response.body);
  });

  it('answers a generic 503 when the repository fails', async () => {
    const { app, settings } = setup();
    settings.failWith = new Error('MongoNetworkError: boom');

    const problem = expectProblem(await request(app).get(SETTINGS), 503, 'service_unavailable');
    expect(JSON.stringify(problem)).not.toContain('boom');
  });
});

describe('PUT /api/v1/costs/settings', () => {
  const put = { ...validRates, version: 0 };

  it('creates the settings with version 0 on an empty store and answers 200 with version 1', async () => {
    const { app, clock } = setup();

    const response = await request(app).put(SETTINGS).send(put);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ...validRates,
      version: 1,
      updatedAt: clock.now().toISOString(),
    });
  });

  it('updates with the current version and bumps it', async () => {
    const { app, settings, clock } = setup();
    settings.stored = { ...saved, version: 1 };
    clock.advanceSeconds(60);

    const response = await request(app)
      .put(SETTINGS)
      .send({ ...validRates, kwhPriceMinor: 9000, version: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ kwhPriceMinor: 9000, version: 2 });
  });

  it.each([
    ['a stale version', 1, 5],
    ['version 0 when a document exists', 0, 2],
  ])('answers 409 on version for %s and keeps the stored document', async (_l, sent, stored) => {
    const { app, settings } = setup();
    settings.stored = { ...saved, version: stored };

    const response = await request(app)
      .put(SETTINGS)
      .send({ ...validRates, version: sent });

    const problem = expectProblem(response, 409, 'conflict');
    expect(problem.issues).toEqual([
      { path: 'version', message: 'Does not match the current version.' },
    ]);
    expect(settings.stored).toEqual({ ...saved, version: stored });
  });

  it('answers 409 for version 5 on an empty store', async () => {
    const { app, settings } = setup();

    const response = await request(app)
      .put(SETTINGS)
      .send({ ...validRates, version: 5 });

    expectProblem(response, 409, 'conflict');
    expect(settings.stored).toBeNull();
  });

  it.each([
    ['an unknown key', { ...put, _id: 'x' }],
    ['a negative price', { ...put, kwhPriceMinor: -1 }],
    ['a price above the cap', { ...put, wearPerHourMinor: 1_000_000_001 }],
    ['a fractional price', { ...put, fixedPerJobMinor: 1.5 }],
    ['a margin above the cap', { ...put, defaultMarginBasisPoints: 100_001 }],
    ['a negative version', { ...put, version: -1 }],
    ['a missing field', { kwhPriceMinor: 1, version: 0 }],
  ])('answers 400 and writes nothing for %s', async (_label, payload) => {
    const { app, settings } = setup();

    const response = await request(app).put(SETTINGS).send(payload);

    expectProblem(response, 400, 'validation_failed');
    expect(settings.calls).toEqual([]);
  });

  it('answers a generic 503 without driver text when the repository fails', async () => {
    const { app, settings } = setup();
    settings.failWith = new Error('MongoNetworkError: ECONNREFUSED');

    const problem = expectProblem(
      await request(app).put(SETTINGS).send(put),
      503,
      'service_unavailable',
    );
    expect(JSON.stringify(problem)).not.toContain('ECONNREFUSED');
  });
});

describe('POST /api/v1/costs/project-estimates', () => {
  const line = { partId: PART_ID, filamentId: FILAMENT_ID, printerId: PRINTER_ID };

  it('answers 200 with the worked example, fixed once and no leaked field', async () => {
    const { app, settings } = setup();
    settings.stored = { ...saved, version: 1 };

    const response = await request(app)
      .post(PROJECTS)
      .send({ lines: [{ ...line, quantity: 2, marginBasisPoints: 2500 }] });

    expect(response.status).toBe(200);
    projectCostEstimateSchema.parse(response.body);
    expect(Object.keys(response.body as object).sort()).toEqual([
      'fixed',
      'lines',
      'marginMinor',
      'materials',
      'printSeconds',
      'subtotalMinor',
      'totalMinor',
      'warnings',
    ]);
    expect(response.body).toMatchObject({
      fixed: { costMinor: 5000 },
      subtotalMinor: 414_240,
      marginMinor: 102_310,
      totalMinor: 516_550,
      printSeconds: 14_400,
      materials: [{ material: 'PETG', grams: 200 }],
      warnings: [],
    });
    const lines = (response.body as { lines: Record<string, unknown>[] }).lines;
    expect(lines[0]).toMatchObject({
      partId: PART_ID,
      subtotalMinor: 409_240,
      totalMinor: 511_550,
    });
    expect(lines[0]).not.toHaveProperty('fixed');
    expect(settings.calls).toEqual(['find']);
  });

  it.each([
    ['no body keys', {}],
    ['an empty list', { lines: [] }],
    ['an unknown key on the body', { lines: [{ ...line, quantity: 1 }], extra: 1 }],
    ['an unknown key on a line', { lines: [{ ...line, quantity: 1, price: 1 }] }],
    ['quantity 0', { lines: [{ ...line, quantity: 0 }] }],
    ['quantity 1001', { lines: [{ ...line, quantity: 1001 }] }],
    ['a fractional quantity', { lines: [{ ...line, quantity: 1.5 }] }],
    ['a missing quantity', { lines: [line] }],
    ['a margin above the limit', { lines: [{ ...line, quantity: 1, marginBasisPoints: 100_001 }] }],
    ['a malformed id', { lines: [{ ...line, partId: 'x', quantity: 1 }] }],
    ['101 lines', { lines: Array.from({ length: 101 }, () => ({ ...line, quantity: 1 })) }],
  ])('answers 400 for %s', async (_name, payload) => {
    const { app, parts } = setup();

    expectProblem(await request(app).post(PROJECTS).send(payload), 400, 'validation_failed');

    expect(parts.calls).toEqual([]);
  });

  it('accepts exactly 100 lines and reads the part once', async () => {
    const { app, parts } = setup();

    const response = await request(app)
      .post(PROJECTS)
      .send({ lines: Array.from({ length: 100 }, () => ({ ...line, quantity: 1000 })) });

    expect(response.status).toBe(200);
    expect(parts.calls).toEqual([PART_ID]);
  });

  it('reports every unknown reference with indexed paths', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(PROJECTS)
      .send({
        lines: [
          { ...line, quantity: 1 },
          { partId: OTHER_ID, filamentId: OTHER_ID, printerId: OTHER_ID, quantity: 1 },
        ],
      });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.map((issue) => issue.path)).toEqual([
      'lines.1.partId',
      'lines.1.filamentId',
      'lines.1.printerId',
    ]);
  });

  it('answers 400 on lines.0.quantity when the amounts overflow', async () => {
    const { app, parts, filaments } = setup();
    parts.records.set(PART_ID, { ...partData, estimatedWeightGrams: 20_000 });
    filaments.records.set(FILAMENT_ID, {
      ...filamentData,
      initialGrams: 1,
      purchaseCostMinor: 1e9,
    });

    const response = await request(app)
      .post(PROJECTS)
      .send({ lines: [{ ...line, quantity: 1000 }] });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues?.[0]?.path).toBe('lines.0.quantity');
  });

  it.each(['parts', 'filaments', 'printers', 'settings'] as const)(
    'answers a generic 503 without driver text when the %s dependency fails',
    async (name) => {
      const { app, ...fakes } = setup();
      fakes[name].failWith = new Error('MongoServerSelectionError: ECONNREFUSED 10.1.2.3:27017');

      const response = await request(app)
        .post(PROJECTS)
        .send({ lines: [{ ...line, quantity: 1 }] });

      const problem = expectProblem(response, 503, 'service_unavailable');
      expect(JSON.stringify(problem)).not.toContain('ECONNREFUSED');
    },
  );
});
