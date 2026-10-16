import {
  defaultStart,
  formatDate,
  formatDateTime,
  formatMinutes,
  parseDate,
  parseTime,
  wallMinutes,
} from './simulation-labels';

/** Argentina is UTC-3, so 13:00Z is 10:00 there. */
const at = (iso: string) => defaultStart(Date.parse(iso));

describe('defaultStart', () => {
  it.each([
    ['2026-10-16T13:00:00Z', '16-10-2026', '10:00'],
    ['2026-10-16T13:00:01Z', '16-10-2026', '10:15'],
    ['2026-10-16T13:07:00Z', '16-10-2026', '10:15'],
    ['2026-10-16T13:15:00Z', '16-10-2026', '10:15'],
    ['2026-10-16T13:46:30Z', '16-10-2026', '11:00'],
    // 23:45 in Argentina is 02:45Z of the next UTC day: an exact quarter stays.
    ['2026-10-17T02:45:00Z', '16-10-2026', '23:45'],
    // 23:50 rolls over to 00:00 of the next Argentina day.
    ['2026-10-17T02:50:00Z', '17-10-2026', '00:00'],
    ['2026-10-17T02:59:00Z', '17-10-2026', '00:00'],
    ['2026-12-31T23:50:00Z', '31-12-2026', '21:00'],
    // And over a year boundary.
    ['2027-01-01T02:50:00Z', '01-01-2027', '00:00'],
  ])('rounds %s up to %s %s', (iso, date, time) => {
    expect(at(iso)).toEqual({ date, time });
  });
});

describe('parseDate', () => {
  it.each([
    ['16-10-2026', '2026-10-16'],
    ['29-02-2028', '2028-02-29'],
    [' 01-01-2000 ', '2000-01-01'],
  ])('accepts %s', (text, iso) => {
    expect(parseDate(text)).toBe(iso);
  });

  it.each([
    '',
    '2026-10-16',
    '31-04-2026',
    '29-02-2027',
    '1-1-2026',
    '16/10/2026',
    '01-01-1999',
    '01-01-2100',
  ])('rejects %j', (text) => {
    expect(parseDate(text)).toBeNull();
  });
});

describe('parseTime', () => {
  it.each(['00:00', '09:05', '23:59'])('accepts %s', (text) => {
    expect(parseTime(text)).toBe(text);
  });

  it.each(['', '24:00', '12:60', '9:05', '12-30', '12:3', 'ab:cd'])('rejects %j', (text) => {
    expect(parseTime(text)).toBeNull();
  });
});

describe('formatting', () => {
  it('turns a wall-clock timestamp into DD-MM-AAAA HH:MM', () => {
    expect(formatDateTime('2026-10-16T09:05')).toBe('16-10-2026 09:05');
  });

  it('turns a date into DD-MM-AAAA', () => {
    expect(formatDate('2026-03-20')).toBe('20-03-2026');
  });

  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [120, '2 h'],
    [150, '2 h 30 min'],
  ])('formats %i minutes as %s', (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });

  it('measures the minutes between two wall-clock timestamps', () => {
    expect(wallMinutes('2026-10-17T00:00') - wallMinutes('2026-10-16T23:00')).toBe(60);
  });
});
