import { describe, expect, it } from 'vitest';
import type { ScheduleRules } from '../availability/index.js';
import {
  deadlineMet,
  formatLocalMinutes,
  minutesOf,
  parseLocalMinutes,
  simulateNaive,
} from './simulations.domain.js';
import { DAY_SHIFT } from './testing/fakes.js';

// 2026-03-02 is a Monday. The default schedule allows 08:00-18:00 every day (18:00 is excluded).
const at = (value: string): number => {
  const parsed = parseLocalMinutes(value);
  if (parsed === null) throw new Error(`bad test time ${value}`);
  return parsed;
};
const text = (minutes: number): string => formatLocalMinutes(minutes);

const run = (
  startAt: string,
  units: number,
  minutes: number,
  options: { printerIds?: string[]; schedule?: ScheduleRules } = {},
) =>
  simulateNaive({
    schedule: options.schedule ?? DAY_SHIFT,
    startAt: at(startAt),
    lines: [{ partId: 'p', units, minutes }],
    printerIds: options.printerIds ?? ['A'],
  });

describe('local time parsing', () => {
  it.each(['2026-03-02T08:00', '2000-01-01T00:00', '2099-12-31T23:59', '2028-02-29T12:30'])(
    'round-trips %s',
    (value) => {
      expect(text(at(value))).toBe(value);
    },
  );

  it.each([
    '2026-03-02',
    '2026-03-02T08:00:00',
    '2026-03-02T08:00Z',
    '2026-03-02 08:00',
    '2026-3-2T08:00',
    '2026-02-30T08:00',
    '2027-02-29T08:00',
    '2026-13-01T08:00',
    '2026-03-02T24:00',
    '2026-03-02T08:60',
    '1999-12-31T23:59',
    '2100-01-01T00:00',
    '',
  ])('rejects %j', (value) => {
    expect(parseLocalMinutes(value)).toBeNull();
  });

  it('counts one day as 1440 minutes', () => {
    expect(at('2026-03-03T00:00') - at('2026-03-02T00:00')).toBe(1440);
  });
});

describe('minutesOf', () => {
  it.each([
    [1, 1],
    [60, 1],
    [61, 2],
    [7200, 120],
    [0, 1],
  ])('%i seconds is %i minutes', (seconds, expected) => {
    expect(minutesOf(seconds)).toBe(expected);
  });
});

describe('simulateNaive, one printer', () => {
  it('chains three 2 h prints from 08:00; each piece is collected when it ends', () => {
    const result = run('2026-03-02T08:00', 3, 120);

    expect(result.jobs.map((job) => [text(job.start), text(job.end), text(job.handoff)])).toEqual([
      ['2026-03-02T08:00', '2026-03-02T10:00', '2026-03-02T10:00'],
      ['2026-03-02T10:00', '2026-03-02T12:00', '2026-03-02T12:00'],
      ['2026-03-02T12:00', '2026-03-02T14:00', '2026-03-02T14:00'],
    ]);
    expect(result.jobs.map((job) => [job.order, job.unit, job.unitsInLine])).toEqual([
      [1, 1, 3],
      [2, 2, 3],
      [3, 3, 3],
    ]);
    expect(result.jobs.some((job) => job.unattended)).toBe(false);
    expect(text(result.finishAt ?? 0)).toBe('2026-03-02T14:00');
    expect(result.printers).toEqual([
      { printerId: 'A', jobs: 3, busyMinutes: 360, idleMinutes: 0 },
    ]);
    expect(result.unplaced).toEqual([]);
  });

  it('runs an 8 h print started at 17:00 through the night; the handoff is next 08:00', () => {
    const result = run('2026-03-02T17:00', 1, 480);
    const [job] = result.jobs;

    expect(text(job?.start ?? 0)).toBe('2026-03-02T17:00');
    expect(text(job?.end ?? 0)).toBe('2026-03-03T01:00');
    expect(text(job?.handoff ?? 0)).toBe('2026-03-03T08:00');
    expect(job?.unattended).toBe(true);
    expect(result.printers[0]).toMatchObject({ busyMinutes: 480, idleMinutes: 420 });
  });

  it('waits for the next morning when the printer is free outside the window', () => {
    // 18:00 is the exclusive end of the range, so nobody can start a print then.
    const result = run('2026-03-02T18:00', 1, 60);

    expect(text(result.jobs[0]?.start ?? 0)).toBe('2026-03-03T08:00');
    expect(result.jobs[0]?.unattended).toBe(false);
  });

  it('starts at the last window minute and waits at the end for the next window', () => {
    const [job] = run('2026-03-02T17:59', 1, 1).jobs;

    expect([text(job?.start ?? 0), text(job?.end ?? 0), text(job?.handoff ?? 0)]).toEqual([
      '2026-03-02T17:59',
      '2026-03-02T18:00',
      '2026-03-03T08:00',
    ]);
    // 18:00 is a minute nobody can attend, but the print ends there.
    expect(job?.unattended).toBe(false);
  });

  it('counts printing as busy and the wait for collection as idle', () => {
    // 600 min prints: 08:00-18:00, collected the next day at 08:00 (840 idle minutes each).
    const result = run('2026-03-02T07:00', 2, 600);

    expect(result.jobs.map((job) => text(job.start))).toEqual([
      '2026-03-02T08:00',
      '2026-03-03T08:00',
    ]);
    expect(result.printers[0]).toMatchObject({
      busyMinutes: 1200,
      idleMinutes: 1680,
    });
  });

  it('skips a day with an empty exception and starts on the next open day', () => {
    const schedule: ScheduleRules = {
      ...DAY_SHIFT,
      exceptions: [{ date: '2026-03-03', ranges: [] }],
    };

    const result = run('2026-03-02T18:00', 1, 60, { schedule });

    expect(text(result.jobs[0]?.start ?? 0)).toBe('2026-03-04T08:00');
  });

  it('honours split ranges on the same day', () => {
    const schedule: ScheduleRules = {
      ...DAY_SHIFT,
      weekly: DAY_SHIFT.weekly.map(() => ({
        ranges: [
          { startMinute: 480, endMinute: 720 },
          { startMinute: 840, endMinute: 1080 },
        ],
      })),
    };

    const [job] = run('2026-03-02T11:00', 1, 120, { schedule }).jobs;

    // Starts 11:00, ends 13:00 (lunch break), collected at 14:00; 12:00-13:00 is unattended.
    expect([text(job?.start ?? 0), text(job?.end ?? 0), text(job?.handoff ?? 0)]).toEqual([
      '2026-03-02T11:00',
      '2026-03-02T13:00',
      '2026-03-02T14:00',
    ]);
    expect(job?.unattended).toBe(true);
  });

  it('places nothing when the user can never intervene', () => {
    const closed: ScheduleRules = {
      weekly: DAY_SHIFT.weekly.map(() => ({ ranges: [] })),
      exceptions: [],
      absences: [],
    };

    const result = run('2026-03-02T08:00', 4, 60, { schedule: closed });

    expect(result.jobs).toEqual([]);
    expect(result.unplaced).toEqual([{ partId: 'p', units: 4 }]);
    expect(result.finishAt).toBeNull();
  });

  it('does not place a unit whose piece could never be collected', () => {
    // Only one open day: the print can start there but nobody can ever take it out.
    const once: ScheduleRules = {
      weekly: DAY_SHIFT.weekly.map(() => ({ ranges: [] })),
      exceptions: [{ date: '2026-03-02', ranges: [{ startMinute: 480, endMinute: 540 }] }],
      absences: [],
    };

    const result = run('2026-03-02T08:00', 1, 60 * 24 * 90, { schedule: once });

    expect(result.jobs).toEqual([]);
    expect(result.unplaced).toEqual([{ partId: 'p', units: 1 }]);
  });
});

describe('simulateNaive, absences', () => {
  const away = (from: string, to: string): ScheduleRules => ({
    ...DAY_SHIFT,
    absences: [{ from, to }],
  });

  it('collects a piece after a 3-day absence in the middle of a queue run', () => {
    // 10 h prints: Mon and Tue run normally; the Tue piece would be collected Wed 08:00, but
    // Wed-Fri are absent, so it waits for Sat 08:00 and the third print starts then.
    const result = run('2026-03-02T08:00', 3, 600, { schedule: away('2026-03-04', '2026-03-06') });

    expect(result.jobs.map((job) => [text(job.start), text(job.end), text(job.handoff)])).toEqual([
      ['2026-03-02T08:00', '2026-03-02T18:00', '2026-03-03T08:00'],
      ['2026-03-03T08:00', '2026-03-03T18:00', '2026-03-07T08:00'],
      ['2026-03-07T08:00', '2026-03-07T18:00', '2026-03-08T08:00'],
    ]);
    expect(result.unplaced).toEqual([]);
  });

  it('collects a print that ends inside the absence at the first intervention minute after it', () => {
    // 25 h from Tue 08:00 ends Wed 09:00, inside the absence; collected Sat 08:00.
    const [job] = run('2026-03-03T08:00', 1, 1500, {
      schedule: away('2026-03-04', '2026-03-06'),
    }).jobs;

    expect([text(job?.start ?? 0), text(job?.end ?? 0), text(job?.handoff ?? 0)]).toEqual([
      '2026-03-03T08:00',
      '2026-03-04T09:00',
      '2026-03-07T08:00',
    ]);
    expect(job?.unattended).toBe(true);
  });

  it('reports units as unplaced when the absence pushes the next start past the 14-day horizon', () => {
    // Horizon ends Mon 03-16 08:00. The first piece is collected only on 03-17, so units 2 and 3
    // cannot start inside the horizon.
    const result = run('2026-03-02T08:00', 3, 600, { schedule: away('2026-03-03', '2026-03-16') });

    expect(result.jobs.map((job) => [text(job.start), text(job.handoff)])).toEqual([
      ['2026-03-02T08:00', '2026-03-17T08:00'],
    ]);
    expect(result.unplaced).toEqual([{ partId: 'p', units: 2 }]);
  });

  it('lets an absence override an exception day that has ranges', () => {
    const schedule: ScheduleRules = {
      ...DAY_SHIFT,
      exceptions: [{ date: '2026-03-03', ranges: [{ startMinute: 480, endMinute: 540 }] }],
      absences: [{ from: '2026-03-03', to: '2026-03-03' }],
    };

    const without = run('2026-03-02T18:00', 1, 60, { schedule: { ...schedule, absences: [] } });
    const result = run('2026-03-02T18:00', 1, 60, { schedule });

    expect(text(without.jobs[0]?.start ?? 0)).toBe('2026-03-03T08:00');
    expect(text(result.jobs[0]?.start ?? 0)).toBe('2026-03-04T08:00');
  });

  it.each([
    [
      'a one-day absence is skipped',
      '2026-03-04',
      '2026-03-04',
      '2026-03-03T18:00',
      '2026-03-05T08:00',
    ],
    [
      'the last absent day is inclusive',
      '2026-03-04',
      '2026-03-05',
      '2026-03-03T18:00',
      '2026-03-06T08:00',
    ],
    [
      'the first absent day is inclusive',
      '2026-03-04',
      '2026-03-04',
      '2026-03-04T08:00',
      '2026-03-05T08:00',
    ],
    [
      'the day before the absence is untouched',
      '2026-03-04',
      '2026-03-06',
      '2026-03-03T17:59',
      '2026-03-03T17:59',
    ],
    [
      'a start inside the absence moves after it',
      '2026-03-02',
      '2026-03-03',
      '2026-03-02T08:00',
      '2026-03-04T08:00',
    ],
  ])('%s', (_label, from, to, startAt, expected) => {
    const [job] = run(startAt, 1, 1, { schedule: away(from, to) }).jobs;

    expect(text(job?.start ?? 0)).toBe(expected);
  });
});

describe('simulateNaive, horizon', () => {
  it('places up to 14 days after the start and reports the rest as unplaced', () => {
    // A 10 h print fills one day (08:00-18:00) and is collected the next morning: one per day.
    const result = run('2026-03-02T08:00', 20, 600);

    expect(result.jobs).toHaveLength(15);
    expect(text(result.jobs.at(-1)?.start ?? 0)).toBe('2026-03-16T08:00');
    expect(result.unplaced).toEqual([{ partId: 'p', units: 5 }]);
  });

  it('does not place a unit that would start one minute after the horizon', () => {
    // From 08:01 the 15th start (day 14, 08:00) is inside the horizon, the 16th is not.
    const result = run('2026-03-02T08:01', 16, 600);

    expect(result.jobs).toHaveLength(15);
    expect(result.unplaced).toEqual([{ partId: 'p', units: 1 }]);
  });

  it('counts unplaced units per part', () => {
    const result = simulateNaive({
      schedule: DAY_SHIFT,
      startAt: at('2026-03-02T08:00'),
      lines: [
        { partId: 'x', units: 14, minutes: 600 },
        { partId: 'y', units: 3, minutes: 600 },
      ],
      printerIds: ['A'],
    });

    expect(result.jobs).toHaveLength(15);
    expect(result.unplaced).toEqual([{ partId: 'y', units: 2 }]);
  });
});

describe('simulateNaive, several printers', () => {
  it('gives each unit to the printer that is free earliest; a tie goes to the first listed', () => {
    const result = run('2026-03-02T08:00', 4, 120, { printerIds: ['A', 'B'] });

    expect(result.jobs.map((job) => [job.printerId, text(job.start)])).toEqual([
      ['A', '2026-03-02T08:00'],
      ['B', '2026-03-02T08:00'],
      ['A', '2026-03-02T10:00'],
      ['B', '2026-03-02T10:00'],
    ]);
    expect(result.printers.map((p) => [p.printerId, p.jobs, p.busyMinutes])).toEqual([
      ['A', 2, 240],
      ['B', 2, 240],
    ]);
  });

  it('balances unequal prints on the printer that frees first', () => {
    const result = simulateNaive({
      schedule: DAY_SHIFT,
      startAt: at('2026-03-02T08:00'),
      lines: [
        { partId: 'long', units: 1, minutes: 240 },
        { partId: 'short', units: 2, minutes: 60 },
      ],
      printerIds: ['A', 'B'],
    });

    expect(result.jobs.map((job) => [job.partId, job.printerId, text(job.start)])).toEqual([
      ['long', 'A', '2026-03-02T08:00'],
      ['short', 'B', '2026-03-02T08:00'],
      ['short', 'B', '2026-03-02T09:00'],
    ]);
  });

  it('keeps a printer that never gets a job with zero minutes', () => {
    const result = run('2026-03-02T08:00', 1, 60, { printerIds: ['A', 'B'] });

    expect(result.printers[1]).toEqual({ printerId: 'B', jobs: 0, busyMinutes: 0, idleMinutes: 0 });
  });
});

describe('deadlineMet', () => {
  const finish = at('2026-03-10T14:00');

  it.each([
    ['2026-03-10', finish, 0, true],
    ['2026-03-11', finish, 0, true],
    ['2026-03-09', finish, 0, false],
    ['2026-03-11', finish, 2, false],
    [null, finish, 0, null],
    ['2026-03-10', null, 0, null],
    ['2026-03-10', null, 3, false],
  ] as const)('deadline %s, finish %s, unplaced %i is %s', (deadline, at_, unplaced, expected) => {
    expect(deadlineMet(deadline, at_, unplaced)).toBe(expected);
  });
});
