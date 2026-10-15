import { describe, expect, it } from 'vitest';
import { GCODE_WARNING_CODES } from './gcode.domain.js';
import {
  analyzeGcodeSchema,
  gcodeAnalysisSchema,
  gcodeWarningCodeSchema,
} from './gcode.schemas.js';

const accepts = (body: unknown): boolean => analyzeGcodeSchema.safeParse(body).success;

describe('analyze gcode request: head', () => {
  it.each([
    ['one character', ';'],
    ['exactly 65536 characters', ';'.repeat(65_536)],
    ['only whitespace (the parser decides, not the schema)', '   \n  '],
  ])('accepts %s', (_label, head) => {
    expect(accepts({ head })).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['65537 characters', ';'.repeat(65_537)],
    ['missing', undefined],
    ['null', null],
    ['a number', 42],
    ['an array', [';']],
    ['an object', { $ne: '' }],
  ])('rejects %s', (_label, head) => {
    expect(accepts({ head })).toBe(false);
  });

  it('does not trim or normalise the text', () => {
    const head = '  ;FLAVOR:Marlin\r\nCafé\n  ';

    expect(analyzeGcodeSchema.parse({ head }).head).toBe(head);
  });
});

describe('analyze gcode request: material and unknown keys', () => {
  it('accepts a catalog material and leaves it optional', () => {
    expect(accepts({ head: ';', material: 'PLA_CF' })).toBe(true);
    expect(accepts({ head: ';' })).toBe(true);
  });

  it.each(['SILK', 'pla', '', null, 5])('rejects the material %j', (material) => {
    expect(accepts({ head: ';', material })).toBe(false);
  });

  it.each(['fileName', 'file', 'id', '$set', 'analyzedAt'])('rejects the key %s', (key) => {
    expect(accepts({ head: ';', [key]: 'x' })).toBe(false);
  });

  it('rejects an own __proto__ key', () => {
    expect(accepts(JSON.parse('{"head":";","__proto__":{"a":1}}'))).toBe(false);
  });

  it.each([null, 'text', 42, [], undefined])('rejects the body %j', (body) => {
    expect(accepts(body)).toBe(false);
  });
});

describe('analysis response schema', () => {
  it('lists every warning code in the contract enum, in order', () => {
    expect(gcodeWarningCodeSchema.options).toEqual([...GCODE_WARNING_CODES]);
    expect(GCODE_WARNING_CODES).toHaveLength(7);
  });

  it('accepts an analysis and rejects an unknown warning code', () => {
    const analysis = {
      slicer: 'cura',
      estimatedPrintSeconds: 1,
      filamentMm: 1,
      filamentGrams: null,
      layerHeightUm: null,
      dimensionsMm: null,
      targetMachineName: null,
      warnings: [{ code: 'MATERIAL_NOT_SELECTED' }],
    };

    expect(gcodeAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(
      gcodeAnalysisSchema.safeParse({ ...analysis, warnings: [{ code: 'SOMETHING_ELSE' }] })
        .success,
    ).toBe(false);
  });
});
