import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE,
  interventionRangesFor,
  isInterventionPossible,
  weekdayOf,
  type ScheduleRules,
} from './availability.domain.js';
import { range } from './testing/fakes.js';

// Hand-checked calendar: 2026-10-12 is a Monday and 2026-10-18 the Sunday after it
// (2026-01-01 is a Thursday; 2026-10-15 is day 288, (288 - 1) % 7 = 0 days after a Thursday).
const MONDAY = '2026-10-12';
const SUNDAY = '2026-10-18';

const rules: ScheduleRules = {
  weekly: [
    { ranges: [range(480, 720), range(840, 1080)] }, // Monday
    { ranges: [] },
    { ranges: [] },
    { ranges: [] },
    { ranges: [] },
    { ranges: [] },
    { ranges: [range(0, 1440)] }, // Sunday: the whole day
  ],
  exceptions: [
    { date: '2026-10-19', ranges: [range(600, 660)] }, // a Monday replaced
    { date: SUNDAY, ranges: [] }, // a Sunday with no intervention at all
  ],
  absences: [
    { from: '2026-11-02', to: '2026-11-07' }, // Monday to Saturday, between two open Sundays
    { from: '2026-12-25', to: '2026-12-25' }, // one day
  ],
};

describe('weekdayOf', () => {
  it.each([
    [MONDAY, 0],
    ['2026-10-15', 3],
    [SUNDAY, 6],
    ['2024-02-29', 3], // a leap day, a Thursday
  ])('%s is weekday %i (0 = Monday)', (date, expected) => {
    expect(weekdayOf(date)).toBe(expected);
  });
});

describe('interventionRangesFor', () => {
  it('uses the weekly day when there is no exception', () => {
    expect(interventionRangesFor(rules, MONDAY)).toEqual([range(480, 720), range(840, 1080)]);
  });

  it('lets an exception replace the weekly day', () => {
    expect(interventionRangesFor(rules, '2026-10-19')).toEqual([range(600, 660)]);
  });

  it('lets an empty exception remove every range of a day that had them', () => {
    expect(interventionRangesFor(rules, SUNDAY)).toEqual([]);
  });

  it('applies the exception to its date only', () => {
    expect(interventionRangesFor(rules, '2026-10-25')).toEqual([range(0, 1440)]);
  });

  it.each([
    ['the first day, inclusive', '2026-11-02', []],
    ['a middle day', '2026-11-03', []],
    ['the last day, inclusive', '2026-11-07', []],
    ['the day before', '2026-11-01', [range(0, 1440)]], // a Sunday
    ['the day after', '2026-11-08', [range(0, 1440)]], // a Sunday
    ['a one-day absence', '2026-12-25', []],
  ])('in an absence: %s', (_label, date, expected) => {
    expect(interventionRangesFor(rules, date)).toEqual(expected);
  });

  it('lets an absence override an exception that has ranges', () => {
    const overridden: ScheduleRules = {
      ...rules,
      absences: [{ from: '2026-10-19', to: '2026-10-19' }],
    };

    expect(interventionRangesFor(overridden, '2026-10-19')).toEqual([]);
    expect(isInterventionPossible(overridden, '2026-10-19', 600)).toBe(false);
  });

  it('lets an absence override a weekly day', () => {
    const away: ScheduleRules = { ...rules, absences: [{ from: MONDAY, to: MONDAY }] };

    expect(isInterventionPossible(away, MONDAY, 600)).toBe(false);
    expect(isInterventionPossible(rules, MONDAY, 600)).toBe(true);
  });
});

describe('isInterventionPossible', () => {
  it.each([
    ['inside the morning range', 600, true],
    ['at the start, inclusive', 480, true],
    ['one minute before the start', 479, false],
    ['at the end, exclusive', 720, false],
    ['the last minute of a range', 719, true],
    ['in the gap between ranges', 780, false],
    ['at midnight', 0, false],
    ['at the end of the day', 1440, false],
  ])('on a Monday %s (minute %i) is %s', (_label, minute, expected) => {
    expect(isInterventionPossible(rules, MONDAY, minute)).toBe(expected);
  });

  it('covers a whole day from 0 up to, not including, 1440', () => {
    const wholeDay: ScheduleRules = { ...rules, exceptions: [] };

    expect(isInterventionPossible(wholeDay, SUNDAY, 0)).toBe(true);
    expect(isInterventionPossible(wholeDay, SUNDAY, 1439)).toBe(true);
    expect(isInterventionPossible(wholeDay, SUNDAY, 1440)).toBe(false);
  });

  it('answers no all day on an empty exception', () => {
    expect(isInterventionPossible(rules, SUNDAY, 600)).toBe(false);
  });

  it('answers yes only inside the exception ranges on an overridden day', () => {
    expect(isInterventionPossible(rules, '2026-10-19', 500)).toBe(false);
    expect(isInterventionPossible(rules, '2026-10-19', 600)).toBe(true);
  });

  it('is 08:00-18:00 every day by default', () => {
    expect(isInterventionPossible(DEFAULT_SCHEDULE, SUNDAY, 480)).toBe(true);
    expect(isInterventionPossible(DEFAULT_SCHEDULE, SUNDAY, 1080)).toBe(false);
  });
});
