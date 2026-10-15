import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../shared/catalog/materials.js';
import { AppError } from '../../shared/errors/app-error.js';
import { gramsFromFilamentLength } from './gcode.domain.js';
import { createGcodeService } from './gcode.service.js';
import { CURA_4_13_HEAD, CURA_5_7_HEAD, headWith } from './testing/cura-headers.js';

const service = createGcodeService();

function failureOf(action: () => unknown): AppError {
  try {
    action();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('analyze', () => {
  it('reads Cura 4.13.1 with PLA: 37 g from the formula', () => {
    const analysis = service.analyze({ head: CURA_4_13_HEAD, material: 'PLA' });

    expect(analysis).toEqual({
      slicer: 'cura',
      estimatedPrintSeconds: 7421,
      filamentMm: 12_482,
      // round(12482 x pi x 0.875^2 x 1.24 / 1000) = round(37.23); the design estimate was ~37.2.
      filamentGrams: 37,
      layerHeightUm: 200,
      dimensionsMm: { x: 92, y: 82, z: 46 },
      targetMachineName: null,
      warnings: ['GRAMS_FROM_DENSITY_TABLE', 'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM'],
    });
  });

  it('reads Cura 5.7.1 with PLA: about 6 g and the machine name', () => {
    const analysis = service.analyze({ head: CURA_5_7_HEAD, material: 'PLA' });

    expect(analysis).toMatchObject({
      estimatedPrintSeconds: 2305,
      filamentMm: 1892,
      filamentGrams: 6,
      layerHeightUm: 160,
      dimensionsMm: { x: 24, y: 24, z: 21 },
      targetMachineName: 'Creality Ender-3 Pro',
    });
  });

  it('gives null grams and MATERIAL_NOT_SELECTED without a material', () => {
    const analysis = service.analyze({ head: CURA_5_7_HEAD });

    expect(analysis.filamentGrams).toBeNull();
    expect(analysis.warnings).toEqual([
      'MATERIAL_NOT_SELECTED',
      'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM',
    ]);
  });

  it.each(MATERIALS)('estimates the grams for %s with the density table', (material) => {
    const analysis = service.analyze({ head: CURA_4_13_HEAD, material });

    expect(analysis.filamentGrams).toBe(gramsFromFilamentLength(12_482, material));
    expect(analysis.warnings).toContain('GRAMS_FROM_DENSITY_TABLE');
  });

  it('gives null grams and WEIGHT_OUT_OF_RANGE above 20000 g', () => {
    const analysis = service.analyze({
      head: headWith({ FILAMENT: ';Filament used: 100000m' }),
      material: 'PLA',
    });

    expect(analysis.filamentGrams).toBeNull();
    expect(analysis.warnings).toContain('WEIGHT_OUT_OF_RANGE');
    expect(analysis.warnings).not.toContain('GRAMS_FROM_DENSITY_TABLE');
  });

  it('gives null grams and WEIGHT_OUT_OF_RANGE when the weight rounds to 0 g', () => {
    const analysis = service.analyze({
      head: headWith({ FILAMENT: ';Filament used: 0.001m' }),
      material: 'PLA',
    });

    expect(analysis.filamentGrams).toBeNull();
    expect(analysis.warnings).toContain('WEIGHT_OUT_OF_RANGE');
  });

  it('adds LAYER_HEIGHT_UNAVAILABLE when the layer height is missing', () => {
    const analysis = service.analyze({ head: headWith({ LAYER: null }), material: 'PLA' });

    expect(analysis.layerHeightUm).toBeNull();
    expect(analysis.warnings).toContain('LAYER_HEIGHT_UNAVAILABLE');
  });

  it('adds DIMENSIONS_UNAVAILABLE and no skirt warning when a side is over 1000 mm', () => {
    const analysis = service.analyze({
      head: headWith({ MINX: ';MINX:-900', MAXX: ';MAXX:900' }),
      material: 'PLA',
    });

    expect(analysis.dimensionsMm).toBeNull();
    expect(analysis.warnings).toContain('DIMENSIONS_UNAVAILABLE');
    expect(analysis.warnings).not.toContain('DIMENSIONS_INCLUDE_SKIRT_OR_BRIM');
  });

  it('sums two extruders and warns about it', () => {
    const analysis = service.analyze({
      head: headWith({ FILAMENT: ';Filament used: 1.5m, 2.25m' }),
      material: 'PLA',
    });

    expect(analysis.filamentMm).toBe(3750);
    expect(analysis.warnings).toContain('MULTIPLE_EXTRUDERS_SUMMED');
  });

  it('does not warn about extruders for one extruder plus an unused one', () => {
    const analysis = service.analyze({ head: headWith({ FILAMENT: ';Filament used: 1m, 0m' }) });

    expect(analysis.warnings).not.toContain('MULTIPLE_EXTRUDERS_SUMMED');
  });

  it('never returns NaN or Infinity', () => {
    const analysis = service.analyze({ head: CURA_4_13_HEAD, material: 'PLA' });

    expect(Number.isFinite(analysis.estimatedPrintSeconds)).toBe(true);
    expect(Number.isFinite(analysis.filamentMm)).toBe(true);
    expect(Number.isFinite(analysis.filamentGrams ?? 0)).toBe(true);
  });
});

describe('analyze: rejected heads', () => {
  it.each([
    ['not a Cura header', 'hello world', 'Not a supported Cura header.'],
    [
      'a missing Cura_SteamEngine line',
      headWith({ GENERATED: null }),
      'Not a supported Cura header.',
    ],
    ['FLAVOR Griffin', headWith({ FLAVOR: ';FLAVOR:Griffin' }), 'Not a supported Cura header.'],
    ['FLAVOR UltiGCode', headWith({ FLAVOR: ';FLAVOR:UltiGCode' }), 'Not a supported Cura header.'],
    [
      'the 6666 s and 0 m placeholder',
      headWith({ TIME: ';TIME:6666', FILAMENT: ';Filament used: 0m' }),
      'The header has no usable time or filament length.',
    ],
    [
      'a negative time',
      headWith({ TIME: ';TIME:-5' }),
      'The header has no usable time or filament length.',
    ],
  ])('answers 400 on head for %s', (_label, head, message) => {
    const error = failureOf(() => service.analyze({ head }));

    expect(error).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(error.issues).toEqual([{ path: 'head', message }]);
  });

  it('never puts text from the file in the error', () => {
    const secret = 'SECRET-FILE-TEXT';
    const error = failureOf(() =>
      service.analyze({ head: `;FLAVOR:${secret}\n;Generated with ${secret}\n` }),
    );

    expect(JSON.stringify({ m: error.message, i: error.issues })).not.toContain(secret);
  });
});
