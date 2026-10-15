import { describe, expect, it } from 'vitest';
import { FILAMENT_DENSITY_G_CM3, MATERIALS } from './materials.js';

// Written out on purpose (ADR 0015): a changed density changes every estimated weight and, later,
// every cost, so changing one must mean changing this table too.
const PINNED_DENSITIES_G_CM3: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  PA: 1.14,
  PC: 1.2,
  HIPS: 1.04,
  PVA: 1.19,
  PP: 0.9,
  PLA_CF: 1.3,
  PETG_CF: 1.3,
  PA_CF: 1.2,
  PA_GF: 1.35,
};

describe('FILAMENT_DENSITY_G_CM3', () => {
  it('has exactly the densities confirmed in ADR 0015', () => {
    expect(FILAMENT_DENSITY_G_CM3).toEqual(PINNED_DENSITIES_G_CM3);
  });

  it.each(MATERIALS)('gives %s a density between 0.8 and 1.5 g/cm3', (material) => {
    const density = FILAMENT_DENSITY_G_CM3[material];

    expect(density).toBeGreaterThanOrEqual(0.8);
    expect(density).toBeLessThanOrEqual(1.5);
  });

  it('has no entry that is not a material', () => {
    expect(Object.keys(FILAMENT_DENSITY_G_CM3).sort()).toEqual([...MATERIALS].sort());
  });
});
