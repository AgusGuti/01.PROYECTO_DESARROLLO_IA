import { describe, expect, it } from 'vitest';
import { updateScheduleSchema } from './availability.schemas.js';
import { range, validRules } from './testing/fakes.js';

const valid = { ...validRules, version: 0 };
const days = (ranges: unknown) => [
  { ranges },
  ...Array.from({ length: 6 }, () => ({ ranges: [] })),
];

/** The issue paths of a rejected body, or null when it is accepted. */
function paths(value: unknown): string[] | null {
  const result = updateScheduleSchema.safeParse(value);
  // De-duplicated: a malformed date fails both the format check and the year check.
  return result.success
    ? null
    : [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
}

describe('update schedule request', () => {
  it('accepts a full schedule and returns it unchanged', () => {
    expect(updateScheduleSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['an unknown top-level key', { ...valid, _id: 'x' }, ['']],
    [
      'an unknown key in a day',
      { ...valid, weekly: days([]).map((d) => ({ ...d, x: 1 })) },
      ['weekly.0', 'weekly.1', 'weekly.2', 'weekly.3', 'weekly.4', 'weekly.5', 'weekly.6'],
    ],
    [
      'an operator key in a range',
      { ...valid, weekly: days([{ startMinute: 1, endMinute: 2, $ne: 1 }]) },
      ['weekly.0.ranges.0'],
    ],
    ['six weekly days', { ...valid, weekly: days([]).slice(0, 6) }, ['weekly']],
    ['eight weekly days', { ...valid, weekly: [...days([]), { ranges: [] }] }, ['weekly']],
    ['a negative version', { ...valid, version: -1 }, ['version']],
    ['a fractional version', { ...valid, version: 1.5 }, ['version']],
    [
      'a missing exceptions list',
      { weekly: valid.weekly, absences: [], version: 0 },
      ['exceptions'],
    ],
    ['a missing absences list', { weekly: valid.weekly, exceptions: [], version: 0 }, ['absences']],
  ])('rejects %s', (_label, body, expected) => {
    expect(paths(body)).toEqual(expected);
  });

  describe('ranges', () => {
    const withRanges = (ranges: unknown) => ({ ...valid, weekly: days(ranges) });

    it('accepts the whole day 0..1440 and touching ranges', () => {
      expect(paths(withRanges([range(0, 1440)]))).toBeNull();
      expect(paths(withRanges([range(0, 60), range(60, 120)]))).toBeNull();
    });

    it('accepts six ranges and rejects seven', () => {
      const six = [0, 1, 2, 3, 4, 5].map((i) => range(i * 100, i * 100 + 50));

      expect(paths(withRanges(six))).toBeNull();
      expect(paths(withRanges([...six, range(700, 750)]))).toEqual(['weekly.0.ranges']);
    });

    it.each([
      ['an empty range', [range(100, 100)], ['weekly.0.ranges.0.endMinute']],
      ['a reversed range', [range(200, 100)], ['weekly.0.ranges.0.endMinute']],
      ['an end past the day', [range(0, 1441)], ['weekly.0.ranges.0.endMinute']],
      ['a negative start', [range(-1, 10)], ['weekly.0.ranges.0.startMinute']],
      ['a fractional minute', [range(0.5, 10)], ['weekly.0.ranges.0.startMinute']],
      ['overlapping ranges', [range(0, 100), range(50, 150)], ['weekly.0.ranges.1.startMinute']],
      ['unsorted ranges', [range(300, 400), range(0, 100)], ['weekly.0.ranges.1.startMinute']],
    ])('rejects %s with the exact field path', (_label, ranges, expected) => {
      expect(paths(withRanges(ranges))).toEqual(expected);
    });

    it('names the second range of the third day', () => {
      const weekly = [
        ...days([]).slice(0, 2),
        { ranges: [range(0, 10), range(20, 15)] },
        ...days([]).slice(3),
      ];

      expect(paths({ ...valid, weekly })).toEqual(['weekly.2.ranges.1.endMinute']);
    });
  });

  describe('absences', () => {
    const withAbsences = (absences: unknown) => ({ ...valid, absences });
    const day = (from: string, to = from) => ({ from, to });

    it('accepts none, one day, a range, adjacent ranges and the date limits', () => {
      expect(paths(withAbsences([]))).toBeNull();
      expect(paths(withAbsences([day('2026-12-25')]))).toBeNull();
      expect(paths(withAbsences([day('2000-01-01', '2099-12-31')]))).toBeNull();
      expect(
        paths(withAbsences([day('2026-03-10', '2026-03-12'), day('2026-03-13', '2026-03-15')])),
      ).toBeNull();
      expect(paths(withAbsences([day('2024-02-28', '2024-02-29')]))).toBeNull();
    });

    it.each([
      ['a day that does not exist', day('2026-02-30', '2026-03-01'), ['absences.0.from']],
      ['a non-leap 29 February', day('2026-01-01', '2026-02-29'), ['absences.0.to']],
      ['a year before 2000', day('1999-12-31', '2000-01-02'), ['absences.0.from']],
      ['a year after 2099', day('2099-12-31', '2100-01-01'), ['absences.0.to']],
      ['a date with a time', day('2026-12-25T00:00:00Z', '2026-12-26'), ['absences.0.from']],
      ['to before from', day('2026-03-10', '2026-03-09'), ['absences.0.to']],
      ['an unknown key', { ...day('2026-03-10'), x: 1 }, ['absences.0']],
    ])('rejects %s with its field path', (_label, entry, expected) => {
      expect(paths(withAbsences([entry]))).toEqual(expected);
    });

    it.each([
      ['an overlap', [day('2026-03-10', '2026-03-12'), day('2026-03-12', '2026-03-15')]],
      ['a contained range', [day('2026-03-10', '2026-03-20'), day('2026-03-12', '2026-03-13')]],
      ['unsorted ranges', [day('2026-03-15', '2026-03-16'), day('2026-03-10', '2026-03-11')]],
    ])('rejects %s on absences.1.from', (_label, absences) => {
      expect(paths(withAbsences(absences))).toEqual(['absences.1.from']);
    });

    it('accepts 30 absences and rejects 31', () => {
      const make = (count: number) =>
        Array.from({ length: count }, (_, i) =>
          day(new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString().slice(0, 10)),
        );

      expect(paths(withAbsences(make(30)))).toBeNull();
      expect(paths(withAbsences(make(31)))).toEqual(['absences']);
    });
  });

  describe('exceptions', () => {
    const withExceptions = (exceptions: unknown) => ({ ...valid, exceptions });

    it('accepts an empty list, an empty-range exception and the date limits', () => {
      expect(paths(withExceptions([]))).toBeNull();
      expect(paths(withExceptions([{ date: '2000-01-01', ranges: [] }]))).toBeNull();
      expect(paths(withExceptions([{ date: '2099-12-31', ranges: [range(0, 10)] }]))).toBeNull();
      expect(paths(withExceptions([{ date: '2024-02-29', ranges: [] }]))).toBeNull();
    });

    it.each([
      ['a day that does not exist', '2026-02-30'],
      ['a non-leap 29 February', '2026-02-29'],
      ['a year before 2000', '1999-12-31'],
      ['a year after 2099', '2100-01-01'],
      ['a date with a time', '2026-12-25T00:00:00Z'],
      ['another format', '25-12-2026'],
    ])('rejects %s', (_label, date) => {
      expect(paths(withExceptions([{ date, ranges: [] }]))).toEqual(['exceptions.0.date']);
    });

    it('rejects a duplicate date at the second occurrence', () => {
      const entry = { date: '2026-12-25', ranges: [] };

      expect(paths(withExceptions([entry, { date: '2026-12-26', ranges: [] }, entry]))).toEqual([
        'exceptions.2.date',
      ]);
    });

    it('accepts 60 exceptions and rejects 61', () => {
      const make = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
          date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
          ranges: [],
        }));

      expect(paths(withExceptions(make(60)))).toBeNull();
      expect(paths(withExceptions(make(61)))).toEqual(['exceptions']);
    });

    it('validates the ranges of an exception with its own path', () => {
      expect(paths(withExceptions([{ date: '2026-12-25', ranges: [range(10, 5)] }]))).toEqual([
        'exceptions.0.ranges.0.endMinute',
      ]);
    });
  });
});
