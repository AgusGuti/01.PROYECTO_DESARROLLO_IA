import { describe, expect, it } from 'vitest';
import { simulationRequestSchema } from './simulations.schemas.js';

const projectId = '66f0c0ffee0123456789abcd';

describe('simulationRequestSchema', () => {
  it.each(['2026-03-02T08:00', '2000-01-01T00:00', '2099-12-31T23:59', '2028-02-29T10:15'])(
    'accepts startAt %s',
    (startAt) => {
      expect(simulationRequestSchema.safeParse({ projectId, startAt }).success).toBe(true);
    },
  );

  it.each([
    ['seconds', '2026-03-02T08:00:00'],
    ['a zone suffix', '2026-03-02T08:00Z'],
    ['an offset', '2026-03-02T08:00-03:00'],
    ['a date only', '2026-03-02'],
    ['a space', '2026-03-02 08:00'],
    ['a missing zero', '2026-3-2T8:00'],
    ['a day that does not exist', '2026-02-30T08:00'],
    ['a non leap day', '2027-02-29T08:00'],
    ['hour 24', '2026-03-02T24:00'],
    ['minute 60', '2026-03-02T08:60'],
    ['year 1999', '1999-12-31T23:59'],
    ['year 2100', '2100-01-01T00:00'],
    ['an empty string', ''],
    ['a number', 20260302],
    ['null', null],
  ])('rejects startAt with %s', (_label, startAt) => {
    const result = simulationRequestSchema.safeParse({ projectId, startAt });

    expect(result.success).toBe(false);
  });

  it.each([
    ['a short id', { projectId: 'abc', startAt: '2026-03-02T08:00' }],
    ['a missing projectId', { startAt: '2026-03-02T08:00' }],
    ['a missing startAt', { projectId }],
    ['an unknown key', { projectId, startAt: '2026-03-02T08:00', horizonDays: 30 }],
    ['an operator id', { projectId: { $ne: '' }, startAt: '2026-03-02T08:00' }],
  ])('rejects a body with %s', (_label, body) => {
    expect(simulationRequestSchema.safeParse(body).success).toBe(false);
  });

  it('lower-cases the project id', () => {
    const parsed = simulationRequestSchema.parse({
      projectId: projectId.toUpperCase(),
      startAt: '2026-03-02T08:00',
    });

    expect(parsed.projectId).toBe(projectId);
  });
});
