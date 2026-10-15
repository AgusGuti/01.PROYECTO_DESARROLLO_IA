import type { Material } from '@print3d/api-contracts';
import { vi } from 'vitest';
import {
  formatDate,
  formatMoney,
  isIsoDate,
  isMaterial,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  MAX_COST_MINOR,
  minorToPesosInput,
  parsePesosToMinor,
  STOCK_LABELS,
  stockLevel,
  todayUtc,
} from './filament-labels';

describe('material labels', () => {
  it('labels every one of the 14 materials in Spanish and orders them all', () => {
    const expected: Material[] = [
      'PLA',
      'PETG',
      'ABS',
      'ASA',
      'TPU',
      'PA',
      'PC',
      'HIPS',
      'PVA',
      'PP',
      'PLA_CF',
      'PETG_CF',
      'PA_CF',
      'PA_GF',
    ];

    expect(Object.keys(MATERIAL_LABELS).sort()).toEqual([...expected].sort());
    expect([...MATERIAL_ORDER].sort()).toEqual([...expected].sort());
    expect(MATERIAL_LABELS.PA_CF).toBe('Nailon con fibra de carbono (PA-CF)');
    expect(MATERIAL_LABELS.PC).toBe('Policarbonato (PC)');
  });

  it('recognises only catalog materials', () => {
    expect(isMaterial('PETG')).toBe(true);
    expect(isMaterial('GOLD')).toBe(false);
    expect(isMaterial('toString')).toBe(false);
    expect(isMaterial(null)).toBe(false);
  });
});

describe('stockLevel', () => {
  it.each([
    [0, 1000, 'none'],
    [0, 1, 'none'],
    [1, 1000, 'low'],
    [200, 1000, 'low'],
    [201, 1000, 'ok'],
    [1000, 1000, 'ok'],
    [1, 5, 'low'],
    [2, 5, 'ok'],
    [1, 1, 'ok'],
  ] as const)('with %i of %i g left the level is %s', (availableGrams, initialGrams, level) => {
    expect(stockLevel({ availableGrams, initialGrams })).toBe(level);
  });

  it('gives every level a text and a symbol, so colour is never the only signal', () => {
    expect(STOCK_LABELS.none.text).toBe('Sin stock');
    expect(STOCK_LABELS.low.text).toBe('Poco stock');
    expect(STOCK_LABELS.ok.text).toBe('Disponible');
    for (const label of Object.values(STOCK_LABELS)) {
      expect(label.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('parsePesosToMinor', () => {
  it.each([
    ['15000', 1500000],
    ['15000,5', 1500050],
    ['15000,50', 1500050],
    ['0,01', 1],
    ['0', 0],
    ['0,00', 0],
    ['7', 700],
    ['9999999', 999999900],
    ['9999999,99', 999999999],
    ['10000000', 1_000_000_000],
    ['10000000,00', 1_000_000_000],
    [' 12,30 ', 1230],
    // parseFloat('1.15') * 100 is 114.99999999999999: integer arithmetic must not drift.
    ['1,15', 115],
    ['19,99', 1999],
    ['4,35', 435],
  ])('converts %j to %i centavos', (text, minor) => {
    expect(parsePesosToMinor(text)).toBe(minor);
  });

  it.each([
    '15.000',
    '1,234',
    '',
    '   ',
    'abc',
    ',5',
    '15000,',
    '-5',
    '1e3',
    '10000000,01',
    '10000001',
    '99999999',
    '1,2,3',
  ])('rejects %j', (text) => {
    expect(parsePesosToMinor(text)).toBeNull();
  });

  it('never accepts more than the API maximum', () => {
    expect(MAX_COST_MINOR).toBe(1_000_000_000);
    const accepted = parsePesosToMinor('9999999,99');
    expect(accepted).not.toBeNull();
    expect(accepted ?? 0).toBeLessThanOrEqual(MAX_COST_MINOR);
  });
});

describe('minorToPesosInput', () => {
  it.each([
    [1500000, '15000'],
    [1500050, '15000,50'],
    [1, '0,01'],
    [0, '0'],
    [1230, '12,30'],
  ])('writes %i centavos as %j', (minor, text) => {
    expect(minorToPesosInput(minor)).toBe(text);
  });

  it('round-trips through the parser', () => {
    for (const minor of [0, 1, 99, 100, 101, 1999, 1500050, 999999999]) {
      expect(parsePesosToMinor(minorToPesosInput(minor))).toBe(minor);
    }
  });
});

describe('formatMoney', () => {
  // The locale puts a no-break space after the symbol; compare with a plain space.
  const plain = (minor: number) => formatMoney(minor).replace(/\s/g, ' ');

  it('shows Argentine pesos with a dot for thousands and a comma for cents', () => {
    expect(plain(1500000)).toBe('$ 15.000,00');
    expect(plain(1500050)).toBe('$ 15.000,50');
    expect(plain(1)).toBe('$ 0,01');
    expect(plain(0)).toBe('$ 0,00');
  });
});

describe('dates', () => {
  it('writes a date as dd/mm/aaaa by splitting the text', () => {
    expect(formatDate('2026-10-01')).toBe('01/10/2026');
    expect(formatDate('2026-01-31')).toBe('31/01/2026');
  });

  it('shows the same day whatever the time zone of the browser is', () => {
    // The test runtime has no way to change the zone, so make every local-time getter lie as a
    // browser in UTC-3 would (the 30th of September): the helpers must not read any of them.
    vi.spyOn(Date.prototype, 'getDate').mockReturnValue(30);
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(8);
    vi.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(22);
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(180);
    try {
      expect(formatDate('2026-10-01')).toBe('01/10/2026');
      expect(todayUtc(new Date('2026-10-01T01:00:00.000Z'))).toBe('2026-10-01');
      expect(isIsoDate('2026-10-01')).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('returns text it does not understand unchanged instead of inventing a date', () => {
    expect(formatDate('not a date')).toBe('not a date');
  });

  it.each(['2026-10-01', '2024-02-29', '0999-12-31'])('accepts the real day %s', (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '', '01/10/2026'])(
    'rejects %j',
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );

  it('rejects values that are not strings', () => {
    expect(isIsoDate(20261001)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('takes today from the UTC date, not from the local one', () => {
    // 01:00 UTC on 1 October is still 30 September in Argentina (UTC-3).
    expect(todayUtc(new Date('2026-10-01T01:00:00.000Z'))).toBe('2026-10-01');
    expect(todayUtc(new Date('2026-10-01T23:59:59.999Z'))).toBe('2026-10-01');
    expect(todayUtc(new Date('2026-10-02T00:00:00.000Z'))).toBe('2026-10-02');
  });
});
