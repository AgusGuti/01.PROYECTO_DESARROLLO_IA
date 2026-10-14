import { describe, expect, it } from 'vitest';
import { createHealthService, type Clock } from './health.service.js';

function fakeClock(...instants: string[]): Clock {
  const queue = instants.map((instant) => new Date(instant));
  return {
    now: () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === undefined) throw new Error('fakeClock needs at least one instant');
      return next;
    },
  };
}

const databaseThatAnswers = (up: boolean) => ({ ping: () => Promise.resolve(up) });

describe('health service', () => {
  it('reports uptime in whole seconds since the service was created', () => {
    const service = createHealthService({
      database: databaseThatAnswers(true),
      clock: fakeClock('2026-01-01T00:00:00.000Z', '2026-01-01T00:01:30.900Z'),
    });

    expect(service.liveness()).toEqual({
      status: 'ok',
      uptimeSeconds: 90,
      timestamp: new Date('2026-01-01T00:01:30.900Z'),
    });
  });

  it('is live without asking the database', () => {
    let pings = 0;
    const service = createHealthService({
      database: {
        ping: () => {
          pings += 1;
          return Promise.resolve(false);
        },
      },
      clock: fakeClock('2026-01-01T00:00:00.000Z'),
    });

    service.liveness();

    expect(pings).toBe(0);
  });

  it('is ready when the database answers', async () => {
    const service = createHealthService({
      database: databaseThatAnswers(true),
      clock: fakeClock('2026-01-01T00:00:00.000Z'),
    });

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ready',
      checks: { database: 'up' },
    });
  });

  it('is not ready when the database does not answer', async () => {
    const service = createHealthService({
      database: databaseThatAnswers(false),
      clock: fakeClock('2026-01-01T00:00:00.000Z'),
    });

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'not_ready',
      checks: { database: 'down' },
    });
  });
});
