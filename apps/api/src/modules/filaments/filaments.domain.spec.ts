import { describe, expect, it } from 'vitest';
import {
  filamentRuleIssues,
  isFutureDate,
  mergeFilament,
  startOfUtcDay,
} from './filaments.domain.js';
import { validFields } from './testing/fakes.js';

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('startOfUtcDay', () => {
  it('returns midnight UTC of the same day, even at the last millisecond', () => {
    expect(startOfUtcDay(new Date('2026-03-01T23:59:59.999Z'))).toEqual(
      new Date('2026-03-01T00:00:00.000Z'),
    );
  });
});

describe('isFutureDate', () => {
  it.each(['2026-03-01T00:00:00.000Z', '2026-03-01T12:00:00.000Z', '2026-03-01T23:59:59.999Z'])(
    'accepts today and rejects tomorrow when the clock reads %s',
    (now) => {
      expect(isFutureDate(day('2026-03-01'), new Date(now))).toBe(false);
      expect(isFutureDate(day('2026-03-02'), new Date(now))).toBe(true);
    },
  );

  it('accepts any past day, however old', () => {
    expect(isFutureDate(day('1900-01-01'), new Date('2026-03-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('mergeFilament', () => {
  it('keeps the current value for an absent key and takes the patched one otherwise', () => {
    const merged = mergeFilament(validFields, { colorName: 'Rojo', availableGrams: 0 });

    expect(merged).toEqual({ ...validFields, colorName: 'Rojo', availableGrams: 0 });
  });
});

describe('filamentRuleIssues', () => {
  const now = new Date('2026-03-01T10:00:00.000Z');

  it('allows a state with available equal to initial and a past date', () => {
    expect(filamentRuleIssues(validFields, now, true)).toEqual([]);
  });

  it('reports availableGrams above initialGrams on the availableGrams path', () => {
    const issues = filamentRuleIssues({ ...validFields, availableGrams: 1001 }, now, true);

    expect(issues).toEqual([{ path: 'availableGrams', message: expect.any(String) }]);
  });

  it('reports a future purchase date on the purchaseDate path', () => {
    const issues = filamentRuleIssues(
      { ...validFields, purchaseDate: day('2026-03-02') },
      now,
      true,
    );

    expect(issues).toEqual([{ path: 'purchaseDate', message: expect.any(String) }]);
  });

  it('skips the date rule when the date is not being changed', () => {
    const old = { ...validFields, purchaseDate: day('2026-03-02') };

    expect(filamentRuleIssues(old, now, false)).toEqual([]);
  });

  it('reports both problems together', () => {
    const issues = filamentRuleIssues(
      { ...validFields, availableGrams: 2000, purchaseDate: day('2026-03-02') },
      now,
      true,
    );

    expect(issues.map((issue) => issue.path)).toEqual(['availableGrams', 'purchaseDate']);
  });
});
