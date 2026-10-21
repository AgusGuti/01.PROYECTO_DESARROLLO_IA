// API tests: the real Express app over HTTP with a fake assistant client.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { chatResponseSchema } from './chat.schemas.js';
import {
  AssistantMessageTooLongError,
  type AssistantClient,
  type GcodeImportClient,
} from './chat.service.js';

const URL = '/api/v1/chat';

function appWith(assistantClient: AssistantClient) {
  return createTestApp({ env: { RATE_LIMIT_MAX: '100000' }, chat: { assistantClient } });
}

describe('POST /api/v1/chat', () => {
  it('answers 200 with { reply, proposal: null } and passes the trimmed message on', async () => {
    const received: string[] = [];
    const app = appWith({
      ask: (message) => {
        received.push(message);
        return Promise.resolve({ reply: 'Hola' });
      },
    });

    const response = await request(app).post(URL).send({ message: '  hola  ' });

    expect(response.status).toBe(200);
    expect(chatResponseSchema.parse(response.body)).toEqual({ reply: 'Hola', proposal: null });
    expect(Object.keys(response.body as object)).toEqual(['reply', 'proposal']);
    expect(received).toEqual(['hola']);
  });

  it('returns a valid proposal and drops an invalid one with a 200', async () => {
    const proposal = {
      kind: 'create_project',
      payload: { name: 'Soportes', deadline: '2026-12-01' },
      itemNames: [],
    };
    const good = await request(appWith({ ask: () => Promise.resolve({ reply: 'ok', proposal }) }))
      .post(URL)
      .send({ message: 'hola' });
    const bad = await request(
      appWith({ ask: () => Promise.resolve({ reply: 'ok', proposal: { ...proposal, id: 1 } }) }),
    )
      .post(URL)
      .send({ message: 'hola' });

    expect(good.body).toEqual({ reply: 'ok', proposal });
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({ reply: 'ok', proposal: null });
  });

  it('returns a valid create_queue proposal and drops one with a bad mode', async () => {
    const printerId = 'b'.repeat(24);
    const proposal = {
      kind: 'create_queue',
      payload: {
        projectId: 'a'.repeat(24),
        goal: 'deadline',
        mode: 'single',
        printerIds: [printerId],
      },
      projectName: 'Soportes',
      printerNames: [{ printerId, name: 'Prusa' }],
    };
    const good = await request(appWith({ ask: () => Promise.resolve({ reply: 'ok', proposal }) }))
      .post(URL)
      .send({ message: 'hola' });
    const bad = await request(
      appWith({
        ask: () =>
          Promise.resolve({
            reply: 'ok',
            proposal: { ...proposal, payload: { ...proposal.payload, mode: 'multi' } },
          }),
      }),
    )
      .post(URL)
      .send({ message: 'hola' });

    expect(good.body).toEqual({ reply: 'ok', proposal });
    expect(chatResponseSchema.parse(good.body).proposal?.kind).toBe('create_queue');
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({ reply: 'ok', proposal: null });
  });

  it('returns a valid update_queue_progress proposal and drops one with completed over quantity', async () => {
    const partId = 'b'.repeat(24);
    const proposal = {
      kind: 'update_queue_progress',
      payload: {
        projectId: 'a'.repeat(24),
        version: 2,
        lines: [{ partId, quantity: 4, completed: 4 }],
      },
      projectName: 'Soportes',
      lineNames: [{ partId, name: 'Soporte' }],
    };
    const bad = {
      ...proposal,
      payload: { ...proposal.payload, lines: [{ partId, quantity: 4, completed: 5 }] },
    };
    const good = await request(appWith({ ask: () => Promise.resolve({ reply: 'ok', proposal }) }))
      .post(URL)
      .send({ message: 'hola' });
    const dropped = await request(
      appWith({ ask: () => Promise.resolve({ reply: 'ok', proposal: bad }) }),
    )
      .post(URL)
      .send({ message: 'hola' });

    expect(good.body).toEqual({ reply: 'ok', proposal });
    expect(chatResponseSchema.parse(good.body).proposal?.kind).toBe('update_queue_progress');
    expect(dropped.status).toBe(200);
    expect(dropped.body).toEqual({ reply: 'ok', proposal: null });
  });

  it.each([
    ['empty', { message: '' }],
    ['whitespace', { message: '   ' }],
    ['2001 characters', { message: 'a'.repeat(2001) }],
    ['an unknown key', { message: 'hola', extra: 1 }],
  ])('answers 400 on %s without calling the assistant', async (_name, body) => {
    let calls = 0;
    const app = appWith({
      ask: () => {
        calls += 1;
        return Promise.resolve({ reply: 'x' });
      },
    });

    const response = await request(app).post(URL).send(body);

    expect(response.status).toBe(400);
    expect(problemSchema.parse(response.body).code).toBe('validation_failed');
    expect(calls).toBe(0);
  });

  it('answers 400 on message when the assistant says it is too long', async () => {
    const app = appWith({ ask: () => Promise.reject(new AssistantMessageTooLongError()) });

    const response = await request(app).post(URL).send({ message: 'hola' });

    expect(response.status).toBe(400);
    expect(problemSchema.parse(response.body).issues).toEqual([
      { path: 'message', message: 'The message is too long.' },
    ]);
  });

  it('answers a generic 503 that holds no assistant text or driver detail', async () => {
    const app = appWith({
      ask: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8000 secret-detail')),
    });

    const response = await request(app).post(URL).send({ message: 'hola' });

    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(problemSchema.parse(response.body).code).toBe('service_unavailable');
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|secret-detail|127\.0\.0\.1/);
  });
});

describe('POST /api/v1/gcode-imports', () => {
  const IMPORT_URL = '/api/v1/gcode-imports';
  const counts = { created: 2, updated: 1, unchanged: 3, skipped: 0, errors: 0 };
  const importApp = (gcodeImportClient: GcodeImportClient) =>
    createTestApp({ env: { RATE_LIMIT_MAX: '100000' }, chat: { gcodeImportClient } });

  it('forwards the validated request to the assistant and returns the counts', async () => {
    const received: unknown[] = [];
    const app = importApp({
      importGcodes: (input) => {
        received.push(input);
        return Promise.resolve(counts);
      },
    });

    const response = await request(app)
      .post(IMPORT_URL)
      .send({ material: 'PLA', folder: ' Minis ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(counts);
    expect(received).toEqual([{ material: 'PLA', folder: 'Minis' }]);
  });

  it.each([
    ['no material', {}],
    ['an unknown material', { material: 'WOOD' }],
    ['a parent folder', { material: 'PLA', folder: '../x' }],
    ['a root chosen by the client', { material: 'PLA', root: 'D:/otra' }],
  ])('answers 400 on %s without calling the assistant', async (_name, body) => {
    let calls = 0;
    const app = importApp({
      importGcodes: () => {
        calls += 1;
        return Promise.resolve(counts);
      },
    });

    const response = await request(app).post(IMPORT_URL).send(body);

    expect(response.status).toBe(400);
    expect(problemSchema.parse(response.body).code).toBe('validation_failed');
    expect(calls).toBe(0);
  });

  it('answers a generic 503 when the assistant fails', async () => {
    const app = importApp({
      importGcodes: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8000 secret')),
    });

    const response = await request(app).post(IMPORT_URL).send({ material: 'PLA' });

    expect(response.status).toBe(503);
    expect(problemSchema.parse(response.body).code).toBe('service_unavailable');
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|secret|127\.0\.0\.1/);
  });

  it('returns an import_gcodes proposal from the chat and drops an unsafe one', async () => {
    const good = { kind: 'import_gcodes', payload: { material: 'PLA', folder: 'Minis' } };
    const bad = { kind: 'import_gcodes', payload: { material: 'PLA', folder: '../x' } };
    const ask = (proposal: unknown) =>
      request(appWith({ ask: () => Promise.resolve({ reply: 'ok', proposal }) }))
        .post(URL)
        .send({ message: 'importá' });

    expect((await ask(good)).body).toMatchObject({ proposal: good });
    expect((await ask(bad)).body).toMatchObject({ reply: 'ok', proposal: null });
  });
});
