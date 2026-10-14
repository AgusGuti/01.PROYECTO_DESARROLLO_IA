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
 * Carbon-fibre (`_CF`) and glass-fibre (`_GF`) filaments wear a brass nozzle quickly.
 * The suffix is the convention: a new reinforced material must follow it (ADR 0007).
 */
export function isReinforcedMaterial(material: Material): boolean {
  return material.endsWith('_CF') || material.endsWith('_GF');
}
