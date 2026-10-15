import { describe, expect, it } from 'vitest';
import { costEstimateRequestSchema, updateCostSettingsSchema } from './costs.schemas.js';
import { FILAMENT_ID, PART_ID, PRINTER_ID } from './testing/fakes.js';

const estimate = { partId: PART_ID, filamentId: FILAMENT_ID };
const settings = {
  kwhPriceMinor: 8000,
  wearPerHourMinor: 150,
  fixedPerJobMinor: 5000,
  defaultMarginBasisPoints: 2500,
  version: 0,
};

const estimateAccepts = (value: unknown): boolean =>
  costEstimateRequestSchema.safeParse(value).success;
const settingsAccepts = (value: unknown): boolean =>
  updateCostSettingsSchema.safeParse(value).success;

describe('estimate request', () => {
  it('defaults the quantity to 1 and leaves the printer and the margin absent', () => {
    expect(costEstimateRequestSchema.parse(estimate)).toEqual({ ...estimate, quantity: 1 });
  });

  it('accepts every field', () => {
    const full = { ...estimate, printerId: PRINTER_ID, quantity: 1000, marginBasisPoints: 100_000 };

    expect(costEstimateRequestSchema.parse(full)).toEqual(full);
  });

  it('rejects an unknown key, including output-only fields and operator keys', () => {
    expect(estimateAccepts({ ...estimate, totalMinor: 1 })).toBe(false);
    expect(estimateAccepts({ ...estimate, _id: PART_ID })).toBe(false);
    expect(estimateAccepts({ ...estimate, $ne: '1' })).toBe(false);
  });

  it.each([0, 1001, 1.5, -1, '2', null])('rejects a quantity of %s', (quantity) => {
    expect(estimateAccepts({ ...estimate, quantity })).toBe(false);
  });

  it.each([1, 1000])('accepts a quantity of %s', (quantity) => {
    expect(estimateAccepts({ ...estimate, quantity })).toBe(true);
  });

  it.each([-1, 100_001, 1.5, '10', null])('rejects a margin of %s', (marginBasisPoints) => {
    expect(estimateAccepts({ ...estimate, marginBasisPoints })).toBe(false);
  });

  it.each([0, 100_000])('accepts a margin of %s', (marginBasisPoints) => {
    expect(estimateAccepts({ ...estimate, marginBasisPoints })).toBe(true);
  });

  it.each(['', 'abc', 'g'.repeat(24), 'a'.repeat(23), 'a'.repeat(25), 12, null, { $ne: '' }])(
    'rejects %j as an id',
    (id) => {
      expect(estimateAccepts({ ...estimate, partId: id })).toBe(false);
      expect(estimateAccepts({ ...estimate, filamentId: id })).toBe(false);
      expect(estimateAccepts({ ...estimate, printerId: id })).toBe(false);
    },
  );

  it('rejects a missing part or spool', () => {
    expect(estimateAccepts({ filamentId: FILAMENT_ID })).toBe(false);
    expect(estimateAccepts({ partId: PART_ID })).toBe(false);
  });
});

describe('settings request', () => {
  it('accepts a complete body', () => {
    expect(updateCostSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each(['kwhPriceMinor', 'wearPerHourMinor', 'fixedPerJobMinor'])(
    'bounds %s to 0..1000000000 integers',
    (field) => {
      expect(settingsAccepts({ ...settings, [field]: 0 })).toBe(true);
      expect(settingsAccepts({ ...settings, [field]: 1_000_000_000 })).toBe(true);
      expect(settingsAccepts({ ...settings, [field]: -1 })).toBe(false);
      expect(settingsAccepts({ ...settings, [field]: 1_000_000_001 })).toBe(false);
      expect(settingsAccepts({ ...settings, [field]: 1.5 })).toBe(false);
      expect(settingsAccepts({ ...settings, [field]: '5' })).toBe(false);
    },
  );

  it('bounds the default margin to 0..100000 integers', () => {
    expect(settingsAccepts({ ...settings, defaultMarginBasisPoints: 100_000 })).toBe(true);
    expect(settingsAccepts({ ...settings, defaultMarginBasisPoints: 100_001 })).toBe(false);
    expect(settingsAccepts({ ...settings, defaultMarginBasisPoints: -1 })).toBe(false);
    expect(settingsAccepts({ ...settings, defaultMarginBasisPoints: 0.5 })).toBe(false);
  });

  it.each([-1, 1.5, '1', null])('rejects a version of %s', (version) => {
    expect(settingsAccepts({ ...settings, version })).toBe(false);
  });

  it.each([
    'kwhPriceMinor',
    'wearPerHourMinor',
    'fixedPerJobMinor',
    'defaultMarginBasisPoints',
    'version',
  ])('rejects a body without %s', (field) => {
    const rest = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== field));

    expect(settingsAccepts(rest)).toBe(false);
  });

  it('rejects unknown keys such as the id or the server-owned dates', () => {
    expect(settingsAccepts({ ...settings, _id: 'costs' })).toBe(false);
    expect(settingsAccepts({ ...settings, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(settingsAccepts({ ...settings, $set: {} })).toBe(false);
  });
});
