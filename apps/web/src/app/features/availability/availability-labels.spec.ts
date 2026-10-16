import { formatDay, formatMinutes, parseDay, parseTime } from './availability-labels';

describe('availability labels', () => {
  it.each([
    ['00:00', 0],
    ['08:00', 480],
    ['8:00', 480],
    ['17:59', 1079],
    ['23:59', 1439],
  ])('converts %s to %i minutes and back', (text, minutes) => {
    expect(parseTime(text, false)).toBe(minutes);
    expect(formatMinutes(minutes)).toBe(text.padStart(5, '0'));
  });

  it('accepts 24:00 only as the end of a range', () => {
    expect(parseTime('24:00', true)).toBe(1440);
    expect(formatMinutes(1440)).toBe('24:00');
    expect(parseTime('24:00', false)).toBeNull();
  });

  it.each(['', '8', '0800', '25:00', '24:01', '12:60', '12:5', 'ab:cd', '-1:00'])(
    'rejects %j as a time',
    (text) => {
      expect(parseTime(text, true)).toBeNull();
    },
  );

  it('converts days between YYYY-MM-DD and DD-MM-YYYY', () => {
    expect(formatDay('2026-11-30')).toBe('30-11-2026');
    expect(parseDay('30-11-2026')).toBe('2026-11-30');
    expect(parseDay('29-02-2028')).toBe('2028-02-29');
  });

  it.each(['', '31-02-2026', '2026-11-30', '1-1-2026', '01-01-1999', '01-01-2100'])(
    'rejects %j as a day',
    (text) => {
      expect(parseDay(text)).toBeNull();
    },
  );
});
