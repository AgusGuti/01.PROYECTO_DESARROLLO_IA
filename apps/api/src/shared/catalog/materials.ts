// Closed list of printable materials shared by printers (CU06) and filaments (CU05). See ADR 0007.
// This folder holds constants, enums and pure helpers only: no framework imports.

export const MATERIALS = [
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
] as const;

export type Material = (typeof MATERIALS)[number];

/**
 * Typical density in g/cm3 (±3 % between brands), used to estimate grams from filament length
 * (ADR 0015). A `Record` over `Material`, so a new material does not compile without a density.
 */
export const FILAMENT_DENSITY_G_CM3: Readonly<Record<Material, number>> = {
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

// shortcut: only 1.75 mm filament is supported, so the diameter is a constant; make it a setting
// (per filament or per printer) if 2.85 mm filament is ever used.
export const FILAMENT_DIAMETER_MM = 1.75;

/**
 * Carbon-fibre (`_CF`) and glass-fibre (`_GF`) filaments wear a brass nozzle quickly.
 * The suffix is the convention: a new reinforced material must follow it (ADR 0007).
 */
export function isReinforcedMaterial(material: Material): boolean {
  return material.endsWith('_CF') || material.endsWith('_GF');
}
