import type { Material, Printer, PrinterStatus } from '@print3d/api-contracts';

export type NozzleMaterial = Printer['nozzle']['material'];
export type NozzleDiameter = Printer['nozzle']['diameterMm'];

// Each table is a `Record` over a contract type: when the API adds a value, the compiler fails
// here until the new value has a Spanish label (ADR 0007).
export const STATUS_LABELS: Readonly<Record<PrinterStatus, string>> = {
  available: 'Disponible',
  in_use: 'En uso',
  maintenance: 'En mantenimiento',
};

export const MATERIAL_LABELS: Readonly<Record<Material, string>> = {
  PLA: 'PLA',
  PETG: 'PETG',
  ABS: 'ABS',
  ASA: 'ASA',
  TPU: 'TPU',
  PA: 'Nailon (PA)',
  PC: 'Policarbonato (PC)',
  HIPS: 'HIPS',
  PVA: 'PVA',
  PP: 'PP',
  PLA_CF: 'PLA con fibra de carbono (PLA-CF)',
  PETG_CF: 'PETG con fibra de carbono (PETG-CF)',
  PA_CF: 'Nailon con fibra de carbono (PA-CF)',
  PA_GF: 'Nailon con fibra de vidrio (PA-GF)',
};

export const NOZZLE_MATERIAL_LABELS: Readonly<Record<NozzleMaterial, string>> = {
  brass: 'Latón',
  hardened_steel: 'Acero endurecido',
  stainless_steel: 'Acero inoxidable',
};

// Option order for the form. Completeness is checked by a test against the label tables.
export const STATUS_ORDER: readonly PrinterStatus[] = ['available', 'in_use', 'maintenance'];
export const NOZZLE_MATERIAL_ORDER: readonly NozzleMaterial[] = [
  'brass',
  'hardened_steel',
  'stainless_steel',
];
export const MATERIAL_ORDER: readonly Material[] = [
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

/** Nozzle diameters the API accepts, in millimetres. */
export const NOZZLE_DIAMETERS_MM: readonly NozzleDiameter[] = [0.2, 0.25, 0.4, 0.6, 0.8, 1];

export function isNozzleDiameter(value: unknown): value is NozzleDiameter {
  return NOZZLE_DIAMETERS_MM.some((diameter) => diameter === value);
}

/** "0.4" becomes "0,4 mm" (Argentine decimal comma). */
export function formatDiameter(diameterMm: number): string {
  return `${String(diameterMm).replace('.', ',')} mm`;
}

/**
 * UI affordance only: fibre-reinforced materials end in _CF or _GF (ADR 0007). The API enforces
 * the real rule; this just lets the form avoid offering a combination that will be rejected.
 */
export function isReinforcedMaterial(material: Material): boolean {
  return material.endsWith('_CF') || material.endsWith('_GF');
}

export function isPrinterStatus(value: unknown): value is PrinterStatus {
  return typeof value === 'string' && Object.hasOwn(STATUS_LABELS, value);
}

export function isMaterial(value: unknown): value is Material {
  return typeof value === 'string' && Object.hasOwn(MATERIAL_LABELS, value);
}

export function isNozzleMaterial(value: unknown): value is NozzleMaterial {
  return typeof value === 'string' && Object.hasOwn(NOZZLE_MATERIAL_LABELS, value);
}
