import { describe, expect, it } from 'vitest';
import { FILAMENT_DENSITY_G_CM3, MATERIALS } from './materials.js';

describe('FILAMENT_DENSITY_G_CM3', () => {
  it.each(MATERIALS)('gives %s a density between 0.8 and 1.5 g/cm3', (material) => {
    const density = FILAMENT_DENSITY_G_CM3[material];

    expect(density).toBeGreaterThanOrEqual(0.8);
    expect(density).toBeLessThanOrEqual(1.5);
  });

  it('has no entry that is not a material', () => {
    expect(Object.keys(FILAMENT_DENSITY_G_CM3).sort()).toEqual([...MATERIALS].sort());
  });
});
