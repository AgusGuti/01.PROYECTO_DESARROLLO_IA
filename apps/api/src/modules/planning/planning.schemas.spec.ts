import { describe, expect, it } from 'vitest';
import { updatePlanningSettingsSchema } from './planning.schemas.js';

const settings = { batchSavingBasisPoints: 1500, version: 0 };
const accepts = (body: unknown): boolean => updatePlanningSettingsSchema.safeParse(body).success;

describe('planning settings request', () => {
  it('accepts a complete body', () => {
    expect(updatePlanningSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each([
    [0, true],
    [5000, true],
    [5001, false],
    [-1, false],
    [0.5, false],
    ['10', false],
    [null, false],
  ])('batchSavingBasisPoints %j is accepted: %s', (value, expected) => {
    expect(accepts({ ...settings, batchSavingBasisPoints: value })).toBe(expected);
  });

  it.each([
    [0, true],
    [7, true],
    [-1, false],
    [1.5, false],
    ['1', false],
    [null, false],
  ])('version %j is accepted: %s', (value, expected) => {
    expect(accepts({ ...settings, version: value })).toBe(expected);
  });

  it.each(['batchSavingBasisPoints', 'version'])('rejects a body without %s', (field) => {
    const rest = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== field));

    expect(accepts(rest)).toBe(false);
  });

  it('rejects unknown keys such as the id or the server-owned dates', () => {
    expect(accepts({ ...settings, _id: 'planning' })).toBe(false);
    expect(accepts({ ...settings, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(accepts({ ...settings, $set: {} })).toBe(false);
  });
});
