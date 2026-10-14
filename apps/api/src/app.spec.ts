// API-level tests: the real Express app, driven over HTTP, with the database faked.
// They pin down the cross-cutting behaviour every future route inherits.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemSchema } from './shared/http/problem.js';
import { createTestApp } from './testing/test-app.js';

describe('health probes', () => {
  it('GET /health/live answers 200 without consulting the database', async () => {
    const app = createTestApp({
      database: { ping: () => Promise.reject(new Error('must not be called')) },
    });

    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('GET /health/ready answers 200 when the database is reachable', async () => {
    const response = await request(createTestApp()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ready', checks: { database: 'up' } });
  });

  it('GET /health/ready answers 503 and names the failing dependency', async () => {
    const app = createTestApp({ database: { ping: () => Promise.resolve(false) } });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: 'not_ready', checks: { database: 'down' } });
  });

  it('is not rate limited', async () => {
    const app = createTestApp({ env: { RATE_LIMIT_MAX: '1' } });

    await request(app).get('/health/live');
    const second = await request(app).get('/health/live');

    expect(second.status).toBe(200);
  });
});

describe('error responses', () => {
  it('returns an RFC 9457 problem for an unknown route', async () => {
    const response = await request(createTestApp()).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(problemSchema.parse(response.body)).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('rejects malformed JSON with 400 and no parser internals', async () => {
    const response = await request(createTestApp())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(problemSchema.parse(response.body).code).toBe('validation_failed');
    expect(JSON.stringify(response.body)).not.toMatch(/SyntaxError|at JSON\.parse|stack/i);
  });

  it('rejects a body over the size limit with 413', async () => {
    const app = createTestApp({ env: { BODY_LIMIT: '1kb' } });

    const response = await request(app)
      .post('/api/v1/anything')
      .send({ padding: 'x'.repeat(5_000) });

    expect(response.status).toBe(413);
    expect(problemSchema.parse(response.body).code).toBe('payload_too_large');
  });

  it('answers 429 once the rate limit is exceeded', async () => {
    const app = createTestApp({ env: { RATE_LIMIT_MAX: '2' } });

    await request(app).get('/api/v1/x');
    await request(app).get('/api/v1/x');
    const third = await request(app).get('/api/v1/x');

    expect(third.status).toBe(429);
    expect(problemSchema.parse(third.body).code).toBe('rate_limited');
  });

  it('hides the cause of an unexpected failure from the client', async () => {
    const app = createTestApp({
      database: {
        ping: () => Promise.reject(new Error('connection string leaked: internal-host')),
      },
    });

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(500);
    expect(problemSchema.parse(response.body).code).toBe('internal');
    expect(JSON.stringify(response.body)).not.toContain('internal-host');
  });
});

describe('request ids', () => {
  it('generates an id and returns it in the header and in the error body', async () => {
    const response = await request(createTestApp()).get('/api/v1/missing');

    const header = response.headers['x-request-id'];
    expect(header).toMatch(/^[0-9a-f-]{36}$/);
    expect(problemSchema.parse(response.body).requestId).toBe(header);
  });

  it('keeps a well-formed id supplied by the client', async () => {
    const response = await request(createTestApp())
      .get('/health/live')
      .set('X-Request-Id', 'trace-abc12345');

    expect(response.headers['x-request-id']).toBe('trace-abc12345');
  });

  it('replaces an unsafe id supplied by the client', async () => {
    const response = await request(createTestApp())
      .get('/health/live')
      .set('X-Request-Id', 'bad id with spaces\tand tabs');

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers and CORS', () => {
  it('does not disclose the framework', async () => {
    const response = await request(createTestApp()).get('/health/live');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows a configured origin', async () => {
    const response = await request(createTestApp())
      .get('/api/v1/x')
      .set('Origin', 'http://localhost:4200');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:4200');
  });

  it('does not allow an origin that is not on the list', async () => {
    const response = await request(createTestApp())
      .get('/api/v1/x')
      .set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
