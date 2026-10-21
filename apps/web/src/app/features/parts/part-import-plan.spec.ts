import type { GcodeAnalysis, Part } from '@print3d/api-contracts';
import { decide, isGcodePath, partName, relativeGcodePath, toPart } from './part-import-plan';

const analysis: GcodeAnalysis = {
  slicer: 'cura',
  estimatedPrintSeconds: 3600,
  filamentMm: 1000,
  filamentGrams: 12,
  layerHeightUm: 200,
  dimensionsMm: { x: 10, y: 20, z: 30 },
  targetMachineName: null,
  warnings: [],
};

function fieldsOf(path = 'Minis/a_b.gcode') {
  const result = toPart(path, analysis, 'PLA');
  if ('skip' in result) throw new Error('unexpected skip');
  return result.part;
}

function stored(): Part {
  const part = fieldsOf();
  return {
    id: 'p1',
    name: 'Mi nombre',
    description: null,
    material: part.material,
    dimensionsMm: part.dimensionsMm,
    estimatedWeightGrams: part.estimatedWeightGrams,
    estimatedPrintSeconds: part.estimatedPrintSeconds,
    layerHeightUm: part.layerHeightUm,
    suggestedPrinterName: null,
    source: {
      kind: 'gcode',
      fileName: 'Minis/a_b.gcode',
      slicer: 'cura',
      analyzedAt: '2026-01-01T00:00:00.000Z',
    },
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('part-import-plan', () => {
  it('drops the folder segment and keeps forward slashes', () => {
    expect(relativeGcodePath('00.GCODES/Minis/0.2mm/a.gcode')).toBe('Minis/0.2mm/a.gcode');
    expect(relativeGcodePath('00.GCODES/a.gcode')).toBe('a.gcode');
  });

  it('accepts .gcode in any case and nothing else', () => {
    expect(isGcodePath('a.GCODE')).toBe(true);
    expect(isGcodePath('desktop.ini')).toBe(false);
    expect(isGcodePath('a.gcode.txt')).toBe(false);
  });

  it('builds a readable name, at most 100 code points', () => {
    expect(partName('Minis/Bowden_square_cutter_0.4mm_3gr.gcode')).toBe(
      'Bowden square cutter 0.4mm 3gr',
    );
    expect(partName('a__b   c.gcode')).toBe('a b c');
    expect(Array.from(partName(`${'a'.repeat(300)}.gcode`))).toHaveLength(100);
  });

  it('skips a file that cannot describe a whole part', () => {
    const skip = (change: Partial<GcodeAnalysis>) =>
      toPart('a.gcode', { ...analysis, ...change }, 'PLA');
    expect(skip({ dimensionsMm: null })).toEqual({ skip: 'no-dimensions' });
    expect(skip({ filamentGrams: null })).toEqual({ skip: 'no-weight' });
    expect(skip({ filamentGrams: 0 })).toEqual({ skip: 'no-weight' });
    expect(skip({ layerHeightUm: null })).toEqual({ skip: 'no-layer-height' });
    expect(skip({ estimatedPrintSeconds: 0 })).toEqual({ skip: 'no-print-time' });
  });

  it('stores the relative path as the source', () => {
    expect(fieldsOf().source).toEqual({
      kind: 'gcode',
      fileName: 'Minis/a_b.gcode',
      slicer: 'cura',
    });
  });

  it('creates when nothing was imported from that file', () => {
    expect(decide(fieldsOf(), undefined).action).toBe('create');
  });

  it('leaves identical data alone', () => {
    expect(decide(fieldsOf(), stored())).toEqual({ action: 'unchanged' });
  });

  it('updates changed data with the stored version and never sends the name', () => {
    const decision = decide({ ...fieldsOf(), estimatedWeightGrams: 99 }, stored());
    expect(decision.action).toBe('update');
    if (decision.action !== 'update') return;
    expect(decision.id).toBe('p1');
    expect(decision.body.version).toBe(3);
    expect(decision.body.estimatedWeightGrams).toBe(99);
    expect('name' in decision.body).toBe(false);
  });

  it('treats a changed dimension or material as a change', () => {
    const dimensionsMm = { x: 10, y: 20, z: 31 };
    expect(decide({ ...fieldsOf(), dimensionsMm }, stored()).action).toBe('update');
    expect(decide({ ...fieldsOf(), material: 'PETG' }, stored()).action).toBe('update');
  });
});
