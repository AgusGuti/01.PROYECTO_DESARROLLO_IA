import { vi } from 'vitest';
import {
  formatDeadline,
  isDeadlineInRange,
  isMaterial,
  isOverdue,
  isPriority,
  linesAndUnits,
  MATERIAL_LABELS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  todayLocal,
} from './project-labels';

describe('project labels', () => {
  it('labels every priority in Spanish and orders them from low to urgent', () => {
    expect(PRIORITY_ORDER.map((value) => PRIORITY_LABELS[value])).toEqual([
      'Baja',
      'Normal',
      'Alta',
      'Urgente',
    ]);
    expect(Object.keys(PRIORITY_LABELS).sort()).toEqual([...PRIORITY_ORDER].sort());
  });

  it('recognises only known priorities', () => {
    expect(isPriority('urgent')).toBe(true);
    expect(isPriority('critical')).toBe(false);
    expect(isPriority('toString')).toBe(false);
    expect(isPriority(2)).toBe(false);
  });

  it('recognises only known materials', () => {
    expect(isMaterial('PLA_CF')).toBe(true);
    expect(isMaterial('GOLD')).toBe(false);
    expect(Object.keys(MATERIAL_LABELS)).toHaveLength(14);
  });
});

describe('formatDeadline', () => {
  it('writes a calendar day as dd/mm/aaaa by splitting the text', () => {
    expect(formatDeadline('2026-11-30')).toBe('30/11/2026');
    expect(formatDeadline('2000-01-05')).toBe('05/01/2000');
  });

  it('does not depend on the time zone because it never builds a Date', () => {
    const dateSpy = vi.spyOn(globalThis, 'Date');

    const text = formatDeadline('2026-01-01');

    expect(text).toBe('01/01/2026');
    expect(dateSpy).not.toHaveBeenCalled();
    dateSpy.mockRestore();
  });

  it('returns text that is not a calendar day unchanged', () => {
    expect(formatDeadline('mañana')).toBe('mañana');
  });
});

describe('todayLocal', () => {
  it('builds the day from the local date parts, zero padded', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59, 59))).toBe('2026-01-05');
    expect(todayLocal(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31');
  });

  it('uses the local day even when the UTC day is already the next one (UTC-3 after 21:00)', () => {
    // A stand-in for 2026-10-15 22:30 in Argentina, which is 2026-10-16 01:30 in UTC. It does not
    // depend on the time zone of the machine running the test, so it also fails in a UTC runner if
    // the code ever switches to the UTC day.
    const argentinaEvening = {
      getFullYear: () => 2026,
      getMonth: () => 9,
      getDate: () => 15,
      toISOString: () => '2026-10-16T01:30:00.000Z',
    };

    expect(todayLocal(argentinaEvening)).toBe('2026-10-15');
    expect(isOverdue('2026-10-15', todayLocal(argentinaEvening))).toBe(false);
  });
});

describe('isOverdue', () => {
  it('is true only for a deadline strictly before today', () => {
    expect(isOverdue('2026-10-14', '2026-10-15')).toBe(true);
    expect(isOverdue('2025-12-31', '2026-01-01')).toBe(true);
  });

  it('is false when the deadline is today', () => {
    expect(isOverdue('2026-10-15', '2026-10-15')).toBe(false);
  });

  it('is false for a future deadline', () => {
    expect(isOverdue('2026-10-16', '2026-10-15')).toBe(false);
    expect(isOverdue('2027-01-01', '2026-12-31')).toBe(false);
  });

  it('is false when there is no deadline', () => {
    expect(isOverdue(null, '2026-10-15')).toBe(false);
  });
});

describe('isDeadlineInRange', () => {
  it.each([
    ['2000-01-01', true],
    ['2099-12-31', true],
    ['1999-12-31', false],
    ['2100-01-01', false],
    ['275760-09-13', false],
    ['', false],
    ['30/11/2026', false],
  ])('for %s answers %s', (value, expected) => {
    expect(isDeadlineInRange(value)).toBe(expected);
  });
});

describe('linesAndUnits', () => {
  it('uses plural and singular forms', () => {
    expect(linesAndUnits(3, 12)).toBe('3 líneas · 12 unidades');
    expect(linesAndUnits(1, 1)).toBe('1 línea · 1 unidad');
    expect(linesAndUnits(0, 0)).toBe('0 líneas · 0 unidades');
  });
});
