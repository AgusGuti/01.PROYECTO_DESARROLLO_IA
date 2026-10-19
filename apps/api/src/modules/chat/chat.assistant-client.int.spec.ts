// Integration: the real fetch client and the real wiring of app.ts against a local HTTP server
// that stands in for the assistant. No MongoDB is needed (the database probe is faked).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/test-app.js';
import { createHttpAssistantClient } from './chat.assistant-client.js';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

describe('chat against a fake assistant over HTTP', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  const seen: { url?: string; body?: string } = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.url = req.url ?? '';
        seen.body = body;
        handler(req, res, body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const json = (res: ServerResponse, status: number, payload: string) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(payload);
  };
  const appFor = () => createTestApp({ env: { ASSISTANT_URL: baseUrl, RATE_LIMIT_MAX: '100000' } });

  it('forwards { message } to the fixed /chat path and returns the reply', async () => {
    handler = (_req, res) => {
      json(res, 200, '{"reply":"Hola desde el asistente"}');
    };

    const response = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reply: 'Hola desde el asistente', proposal: null });
    expect(seen).toEqual({ url: '/chat', body: '{"message":"hola"}' });
  });

  it('passes a valid proposal through and drops an invalid one', async () => {
    const proposal = {
      kind: 'create_project',
      payload: { name: 'Soportes', items: [{ partId: 'a'.repeat(24), quantity: 3 }] },
      itemNames: [{ partId: 'a'.repeat(24), name: 'Soporte' }],
    };
    handler = (_req, res) => {
      json(res, 200, JSON.stringify({ reply: 'Propuesta', proposal }));
    };
    const good = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    handler = (_req, res) => {
      json(res, 200, JSON.stringify({ reply: 'Propuesta', proposal: { ...proposal, kind: 'x' } }));
    };
    const bad = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    expect(good.body).toEqual({ reply: 'Propuesta', proposal });
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({ reply: 'Propuesta', proposal: null });
  });

  it('passes a create_queue proposal through and drops one with a name mismatch', async () => {
    const printerId = 'b'.repeat(24);
    const proposal = {
      kind: 'create_queue',
      payload: {
        projectId: 'a'.repeat(24),
        goal: 'fastest',
        mode: 'single',
        printerIds: [printerId],
      },
      projectName: 'Soportes',
      printerNames: [{ printerId, name: 'Prusa' }],
    };
    handler = (_req, res) => {
      json(res, 200, JSON.stringify({ reply: 'Cola', proposal }));
    };
    const good = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    handler = (_req, res) => {
      const wrong = { ...proposal, printerNames: [{ printerId: 'c'.repeat(24), name: 'x' }] };
      json(res, 200, JSON.stringify({ reply: 'Cola', proposal: wrong }));
    };
    const bad = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    expect(good.body).toEqual({ reply: 'Cola', proposal });
    expect(bad.body).toEqual({ reply: 'Cola', proposal: null });
  });

  it('passes an update_queue_progress proposal through and drops one with completed over quantity', async () => {
    const partId = 'b'.repeat(24);
    const proposal = {
      kind: 'update_queue_progress',
      payload: {
        projectId: 'a'.repeat(24),
        version: 3,
        lines: [{ partId, quantity: 4, completed: 1 }],
      },
      projectName: 'Soportes',
      lineNames: [{ partId, name: 'Soporte' }],
    };
    handler = (_req, res) => {
      json(res, 200, JSON.stringify({ reply: 'Reanudo', proposal }));
    };
    const good = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    handler = (_req, res) => {
      const wrong = {
        ...proposal,
        payload: { ...proposal.payload, lines: [{ partId, quantity: 4, completed: 9 }] },
      };
      json(res, 200, JSON.stringify({ reply: 'Reanudo', proposal: wrong }));
    };
    const bad = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    expect(good.body).toEqual({ reply: 'Reanudo', proposal });
    expect(bad.body).toEqual({ reply: 'Reanudo', proposal: null });
  });

  it('maps an assistant 413 to a 400 on message', async () => {
    handler = (_req, res) => {
      json(res, 413, '{"detail":"El mensaje es demasiado largo."}');
    };

    const response = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    expect(response.status).toBe(400);
  });

  it.each([
    ['a 5xx', 503, '{"detail":"modelo caido internal-text"}'],
    ['a reply without the field', 200, '{"answer":"x"}'],
    ['a reply that is not JSON', 200, 'internal-text <html>'],
    ['an empty reply', 200, '{"reply":""}'],
  ])('answers a generic 503 on %s', async (_name, status, payload) => {
    handler = (_req, res) => {
      json(res, status, payload);
    };

    const response = await request(appFor()).post('/api/v1/chat').send({ message: 'hola' });

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('internal-text');
  });

  it('answers 503 when the assistant does not answer before the timeout', async () => {
    handler = () => undefined; // never responds
    const app = createTestApp({
      env: { RATE_LIMIT_MAX: '100000' },
      chat: { assistantClient: createHttpAssistantClient({ baseUrl, timeoutMs: 150 }) },
    });

    const response = await request(app).post('/api/v1/chat').send({ message: 'hola' });

    expect(response.status).toBe(503);
  });

  it('answers 503 when nothing listens at the configured URL', async () => {
    const app = createTestApp({
      env: { ASSISTANT_URL: 'http://127.0.0.1:1', RATE_LIMIT_MAX: '100000' },
    });

    const response = await request(app).post('/api/v1/chat').send({ message: 'hola' });

    expect(response.status).toBe(503);
  });
});
