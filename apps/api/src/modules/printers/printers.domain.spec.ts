import { describe, expect, it } from 'vitest';
import { isReinforcedMaterial, MATERIALS, type Material } from '../../shared/catalog/materials.js';
import {
  isArchived,
  materialsNeedingHardenedNozzle,
  mergePrinter,
  type NozzleMaterial,
  type PrinterFields,
} from './printers.domain.js';
import { validFields } from './testing/fakes.js';

const nozzleOf = (material: NozzleMaterial) => ({ diameterMm: 0.4, material }) as const;

// Written out by hand, independent of isReinforcedMaterial: true = allowed with that nozzle.
const ALLOWED: readonly (readonly [Material, boolean, boolean, boolean])[] = [
  // material, brass, hardened_steel, stainless_steel
  ['PLA', true, true, true],
  ['PETG', true, true, true],
  ['ABS', true, true, true],
  ['ASA', true, true, true],
  ['TPU', true, true, true],
  ['PA', true, true, true],
  ['PC', true, true, true],
  ['HIPS', true, true, true],
  ['PVA', true, true, true],
  ['PP', true, true, true],
  ['PLA_CF', false, true, false],
  ['PETG_CF', false, true, false],
  ['PA_CF', false, true, false],
  ['PA_GF', false, true, false],
];

describe('material catalog', () => {
  it('lists exactly the fourteen agreed materials', () => {
    expect([...MATERIALS]).toEqual([
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
    ]);
  });

  it.each(['PA', 'PC', 'PP'] as const)('does not treat %s as reinforced', (material) => {
    expect(isReinforcedMaterial(material)).toBe(false);
  });

  it.each(['PLA_CF', 'PETG_CF', 'PA_CF', 'PA_GF'] as const)(
    'treats %s as reinforced',
    (material) => {
      expect(isReinforcedMaterial(material)).toBe(true);
    },
  );
});

describe('materialsNeedingHardenedNozzle', () => {
  it('covers every material in the catalog in the expected table', () => {
    expect(ALLOWED.map(([material]) => material)).toEqual([...MATERIALS]);
  });

  it.each(ALLOWED)(
    '%s: allowed with brass=%s, hardened_steel=%s, stainless_steel=%s',
    (material, brass, hardened, stainless) => {
      const verdicts = (['brass', 'hardened_steel', 'stainless_steel'] as const).map(
        (nozzle) =>
          materialsNeedingHardenedNozzle({
            nozzle: nozzleOf(nozzle),
            compatibleMaterials: [material],
          }).length === 0,
      );

      expect(verdicts).toEqual([brass, hardened, stainless]);
    },
  );

  it('names every offending material in a mixed list and ignores the others', () => {
    const offenders = materialsNeedingHardenedNozzle({
      nozzle: nozzleOf('brass'),
      compatibleMaterials: ['PLA', 'PA_CF', 'PETG', 'PA_GF', 'PA'],
    });

    expect(offenders).toEqual(['PA_CF', 'PA_GF']);
  });

  it('accepts any list with a hardened steel nozzle', () => {
    expect(
      materialsNeedingHardenedNozzle({
        nozzle: nozzleOf('hardened_steel'),
        compatibleMaterials: [...MATERIALS],
      }),
    ).toEqual([]);
  });
});

describe('mergePrinter', () => {
  const current: PrinterFields = { ...validFields, typicalSpeedMmS: 60 };

  it('keeps every field that the patch leaves out', () => {
    expect(mergePrinter(current, { name: 'Prusa' })).toEqual({ ...current, name: 'Prusa' });
  });

  it('replaces nested objects and lists whole', () => {
    const merged = mergePrinter(current, {
      buildVolume: { x: 1, y: 2, z: 3 },
      compatibleMaterials: ['ABS'],
    });

    expect(merged.buildVolume).toEqual({ x: 1, y: 2, z: 3 });
    expect(merged.compatibleMaterials).toEqual(['ABS']);
  });

  it('clears the speed when the patch says null and keeps it when the key is absent', () => {
    expect(mergePrinter(current, { typicalSpeedMmS: null }).typicalSpeedMmS).toBeNull();
    expect(mergePrinter(current, {}).typicalSpeedMmS).toBe(60);
    expect(mergePrinter({ ...current, powerWatts: 100 }, {}).powerWatts).toBe(100);
    expect(
      mergePrinter({ ...current, powerWatts: 100 }, { powerWatts: null }).powerWatts,
    ).toBeNull();
    expect(mergePrinter(current, { powerWatts: 90 }).powerWatts).toBe(90);
  });
});

describe('isArchived', () => {
  it('is true only when archivedAt is set', () => {
    expect(isArchived({ archivedAt: null })).toBe(false);
    expect(isArchived({ archivedAt: new Date() })).toBe(true);
  });
});
