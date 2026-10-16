// API tests: the real Express app over HTTP with a fake assistant client.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from '../../shared/http/problem.js';
import { createTestApp } from '../../testing/test-app.js';
import { chatResponseSchema } from './chat.schemas.js';
import { AssistantMessageTooLongError, type AssistantClient } from './chat.service.js';

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
