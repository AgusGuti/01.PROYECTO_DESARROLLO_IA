import type { GcodeWarningCode, Material } from '@print3d/api-contracts';
import {
  formatDuration,
  formatInstantDate,
  GCODE_WARNING_LABELS,
  hmsToSeconds,
  isGcodeWarningCode,
  isMaterial,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  parseMmToUm,
  secondsToHms,
  toSourceFileName,
  umToMmInput,
} from './part-labels';

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
    expect(MATERIAL_LABELS.PC).toBe('Policarbonato (PC)');
  });

  it('recognises only catalog materials', () => {
    expect(isMaterial('PETG')).toBe(true);
    expect(isMaterial('GOLD')).toBe(false);
    expect(isMaterial('toString')).toBe(false);
    expect(isMaterial(null)).toBe(false);
  });
});

describe('G-code warning labels', () => {
  it('gives every contract warning code a Spanish text', () => {
    const codes: GcodeWarningCode[] = [
      'GRAMS_FROM_DENSITY_TABLE',
      'MATERIAL_NOT_SELECTED',
      'WEIGHT_OUT_OF_RANGE',
      'LAYER_HEIGHT_UNAVAILABLE',
      'DIMENSIONS_UNAVAILABLE',
      'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM',
      'MULTIPLE_EXTRUDERS_SUMMED',
    ];

    expect(Object.keys(GCODE_WARNING_LABELS).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(GCODE_WARNING_LABELS[code].length).toBeGreaterThan(10);
  });

  it('recognises only known warning codes', () => {
    expect(isGcodeWarningCode('MULTIPLE_EXTRUDERS_SUMMED')).toBe(true);
    expect(isGcodeWarningCode('NEW_CODE')).toBe(false);
    expect(isGcodeWarningCode('toString')).toBe(false);
    expect(isGcodeWarningCode(3)).toBe(false);
  });
});

describe('formatDuration', () => {
  it.each([
    [7380, '2 h 03 min'],
    [3600, '1 h 00 min'],
    [3659, '1 h 00 min'],
    [3660, '1 h 01 min'],
    [2700, '45 min'],
    [60, '1 min'],
    [59, '59 s'],
    [1, '1 s'],
    [2_592_000, '720 h 00 min'],
  ])('writes %i seconds as %j', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('time conversions', () => {
  it.each([
    [7380, { hours: 2, minutes: 3, seconds: 0 }],
    [3661, { hours: 1, minutes: 1, seconds: 1 }],
    [59, { hours: 0, minutes: 0, seconds: 59 }],
    [2_592_000, { hours: 720, minutes: 0, seconds: 0 }],
  ])('splits %i seconds into hours, minutes and seconds', (total, hms) => {
    expect(secondsToHms(total)).toEqual(hms);
  });

  it('joins hours, minutes and seconds back and round-trips', () => {
    expect(hmsToSeconds(2, 3, 0)).toBe(7380);
    expect(hmsToSeconds(0, 0, 1)).toBe(1);
    for (const total of [1, 59, 60, 3599, 3600, 7380, 86_399, 2_592_000]) {
      const { hours, minutes, seconds } = secondsToHms(total);
      expect(hmsToSeconds(hours, minutes, seconds)).toBe(total);
    }
  });
});

describe('parseMmToUm', () => {
  it.each([
    ['0,2', 200],
    ['0,16', 160],
    ['0,20', 200],
    ['0,125', 125],
    ['0,01', 10],
    ['2', 2000],
    ['1', 1000],
    ['0,3', 300],
    // parseFloat('0.29') * 1000 is 290.00000000000006: integer arithmetic must not drift.
    ['0,29', 290],
    ['1,15', 1150],
    [' 0,2 ', 200],
  ])('converts %j to %i micrometres', (text, um) => {
    expect(parseMmToUm(text)).toBe(um);
  });

  it.each([
    '0,2000',
    'abc',
    '',
    '   ',
    '0,2,1',
    '0.2',
    ',2',
    '0,',
    '-0,2',
    '1e-1',
    '0',
    '0,005',
    '0,009',
    '2,001',
    '2,01',
    '3',
    '99999',
  ])('rejects %j', (text) => {
    expect(parseMmToUm(text)).toBeNull();
  });

  it('accepts exactly the range 10..2000 micrometres', () => {
    expect(parseMmToUm('0,01')).toBe(10);
    expect(parseMmToUm('2')).toBe(2000);
    expect(parseMmToUm('2,000')).toBe(2000);
    expect(parseMmToUm('0,009')).toBeNull();
    expect(parseMmToUm('2,001')).toBeNull();
  });
});

describe('umToMmInput', () => {
  it.each([
    [200, '0,2'],
    [160, '0,16'],
    [125, '0,125'],
    [10, '0,01'],
    [2000, '2'],
    [1000, '1'],
    [1150, '1,15'],
  ])('writes %i micrometres as %j', (um, text) => {
    expect(umToMmInput(um)).toBe(text);
  });

  it('round-trips every valid layer height through the parser', () => {
    for (let um = 10; um <= 2000; um += 1) {
      expect(parseMmToUm(umToMmInput(um))).toBe(um);
    }
  });
});

describe('formatInstantDate', () => {
  it('writes an instant as dd/mm/aaaa', () => {
    expect(formatInstantDate('2026-10-15T15:00:00.000Z')).toMatch(/^1[45]\/10\/2026$/);
  });

  it('returns text it does not understand unchanged', () => {
    expect(formatInstantDate('not a date')).toBe('not a date');
  });
});

describe('toSourceFileName', () => {
  it('keeps a normal name as it is', () => {
    expect(toSourceFileName('soporte_v2.gcode')).toBe('soporte_v2.gcode');
  });

  it('strips control characters', () => {
    expect(toSourceFileName('a\u0000b\nc\u007fd\u009fe.gcode')).toBe('abcde.gcode');
  });

  it('falls back to a fixed name when nothing printable is left', () => {
    expect(toSourceFileName('')).toBe('archivo.gcode');
    expect(toSourceFileName('   ')).toBe('archivo.gcode');
    expect(toSourceFileName('\u0000 \n \u007f')).toBe('archivo.gcode');
  });

  it('keeps exactly 255 code points and cuts a longer name by code point', () => {
    expect(Array.from(toSourceFileName('a'.repeat(255)))).toHaveLength(255);
    expect(Array.from(toSourceFileName('a'.repeat(300)))).toHaveLength(255);
    // Emoji are one code point (two UTF-16 units): the cut must not split one.
    const cut = toSourceFileName('🙂'.repeat(300));
    expect(Array.from(cut)).toHaveLength(255);
    expect(cut).not.toContain('�');
    // encodeURIComponent throws on a lone surrogate half.
    expect(() => encodeURIComponent(cut)).not.toThrow();
  });

  it('falls back to a fixed name when nothing is left', () => {
    expect(toSourceFileName('\u0000\n')).toBe('archivo.gcode');
  });
});
