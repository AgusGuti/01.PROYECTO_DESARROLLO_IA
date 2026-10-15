// API tests: the real Express app over HTTP. The gcode module has no repository to fake.
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from '../../shared/http/problem.js';
import type { AppDependencies } from '../../app.js';
import { createTestApp } from '../../testing/test-app.js';
import { gcodeAnalysisSchema } from './gcode.schemas.js';
import { CURA_4_13_HEAD, CURA_5_7_HEAD, headWith } from './testing/cura-headers.js';

const URL = '/api/v1/gcode-analyses';

const ANALYSIS_KEYS = [
  'dimensionsMm',
  'estimatedPrintSeconds',
  'filamentGrams',
  'filamentMm',
  'layerHeightUm',
  'slicer',
  'targetMachineName',
  'warnings',
];

type PartsRepository = NonNullable<NonNullable<AppDependencies['parts']>['repository']>;

// The analysis needs no repository: this one records any call, so the tests can prove it is unused.
function setup() {
  const calls: string[] = [];
  const track = (name: string) => () => {
    calls.push(name);
    return Promise.reject(new Error('the gcode route must not touch a repository'));
  };
  const repository: PartsRepository = {
    create: track('create'),
    findLiveById: track('findLiveById'),
    list: track('list'),
    update: track('update'),
    softDelete: track('softDelete'),
  };
  const app = createTestApp({ env: { RATE_LIMIT_MAX: '100000' }, parts: { repository } });
  return { app, parts: { calls } };
}

function expectProblem(response: request.Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toContain('application/problem+json');
  const problem = problemSchema.parse(response.body);
  expect(problem).toMatchObject({ status, code });
  return problem;
}

describe('POST /api/v1/gcode-analyses', () => {
  it('answers 200 with the numbers of a Cura 4.13.1 head', async () => {
    const { app } = setup();

    const response = await request(app).post(URL).send({ head: CURA_4_13_HEAD, material: 'PLA' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      slicer: 'cura',
      estimatedPrintSeconds: 7421,
      filamentMm: 12_482,
      filamentGrams: 37,
      layerHeightUm: 200,
      dimensionsMm: { x: 92, y: 82, z: 46 },
      targetMachineName: null,
      warnings: [
        { code: 'GRAMS_FROM_DENSITY_TABLE' },
        { code: 'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM' },
      ],
    });
    gcodeAnalysisSchema.parse(response.body);
  });

  it('answers 200 with the numbers of a Cura 5.7.1 head and no material', async () => {
    const { app } = setup();

    const response = await request(app).post(URL).send({ head: CURA_5_7_HEAD });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      estimatedPrintSeconds: 2305,
      filamentMm: 1892,
      filamentGrams: null,
      dimensionsMm: { x: 24, y: 24, z: 21 },
      targetMachineName: 'Creality Ender-3 Pro',
      warnings: [{ code: 'MATERIAL_NOT_SELECTED' }, { code: 'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM' }],
    });
  });

  it('exposes exactly the analysis keys and creates no Location', async () => {
    const { app } = setup();

    const response = await request(app).post(URL).send({ head: CURA_5_7_HEAD });

    expect(Object.keys(response.body as object).sort()).toEqual(ANALYSIS_KEYS);
    expect(response.headers['location']).toBeUndefined();
  });

  it('parses a head sent with CRLF line endings and a byte order mark', async () => {
    const { app } = setup();
    const head = `${String.fromCharCode(0xfeff)}${CURA_5_7_HEAD.replaceAll('\n', '\r\n')}`;

    const response = await request(app).post(URL).send({ head });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ estimatedPrintSeconds: 2305 });
  });

  it('drops a machine name that is not printable ASCII', async () => {
    const { app } = setup();
    const head = headWith({ MACHINE: ';TARGET_MACHINE.NAME:Ender 3 é' });

    const response = await request(app).post(URL).send({ head });

    expect(response.body).toHaveProperty('targetMachineName', null);
  });

  it.each([
    ['not a Cura header', 'hello world', 'Not a supported Cura header.'],
    ['FLAVOR Griffin', headWith({ FLAVOR: ';FLAVOR:Griffin' }), 'Not a supported Cura header.'],
    [
      'the 6666 s and 0 m placeholder',
      headWith({ TIME: ';TIME:6666', FILAMENT: ';Filament used: 0m' }),
      'The header has no usable time or filament length.',
    ],
  ])('answers 400 with an issue on head for %s', async (_label, head, message) => {
    const { app } = setup();

    const response = await request(app).post(URL).send({ head });

    const problem = expectProblem(response, 400, 'validation_failed');
    expect(problem.issues).toEqual([{ path: 'head', message }]);
  });

  it.each([
    ['an empty head', { head: '' }],
    ['a missing head', {}],
    ['a head of 65537 characters', { head: ';'.repeat(65_537) }],
    ['an unknown material', { head: CURA_5_7_HEAD, material: 'SILK' }],
    ['a file name', { head: CURA_5_7_HEAD, fileName: 'a.gcode' }],
    ['an operator key', { head: CURA_5_7_HEAD, $set: { head: 'x' } }],
    ['a non-string head', { head: 5 }],
  ])('answers 400 for %s', async (_label, payload) => {
    const { app } = setup();

    expectProblem(await request(app).post(URL).send(payload), 400, 'validation_failed');
  });

  it('accepts a head of exactly 65536 characters', async () => {
    const { app } = setup();
    const head = `${CURA_5_7_HEAD}${';'.repeat(65_536 - CURA_5_7_HEAD.length)}`;

    const response = await request(app).post(URL).send({ head });

    expect(head).toHaveLength(65_536);
    expect(response.status).toBe(200);
  });

  it('answers 400 for a request without a JSON body', async () => {
    const { app } = setup();

    expectProblem(await request(app).post(URL), 400, 'validation_failed');
  });

  it('answers 413 for a body over the size limit and touches no repository', async () => {
    const { app, parts } = setup();

    const response = await request(app)
      .post(URL)
      .send({ head: ';'.repeat(200_000) });

    expectProblem(response, 413, 'payload_too_large');
    expect(parts.calls).toEqual([]);
  });

  it('answers 413 for a short head whose JSON escapes grow the body past the limit', async () => {
    const { app } = setup();

    const response = await request(app)
      .post(URL)
      .send({ head: '\u0001'.repeat(65_536) });

    expectProblem(response, 413, 'payload_too_large');
  });

  it('answers a problem body for a GET', async () => {
    const { app } = setup();

    const response = await request(app).get(URL);

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('never returns the text of a rejected file', async () => {
    const { app } = setup();
    const secret = 'SECRET-FILE-TEXT';

    const response = await request(app)
      .post(URL)
      .send({ head: `;FLAVOR:${secret}\n` });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(secret);
  });
});

describe('logging', () => {
  it('never lets the head text reach the logger, on success or on failure', async () => {
    const lines: string[] = [];
    const logger = pino({ level: 'trace' }, { write: (line: string) => void lines.push(line) });
    const app = createTestApp({ logger, env: { RATE_LIMIT_MAX: '100000' } });
    const secret = 'SECRET-FILE-TEXT';

    await request(app)
      .post(URL)
      .send({ head: `${CURA_5_7_HEAD};${secret}\n`, material: 'PLA' });
    await request(app)
      .post(URL)
      .send({ head: `;FLAVOR:${secret}\n` });
    await request(app)
      .post(URL)
      .send({ head: `${secret}${';'.repeat(200_000)}` });

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain(secret);
  });
});
