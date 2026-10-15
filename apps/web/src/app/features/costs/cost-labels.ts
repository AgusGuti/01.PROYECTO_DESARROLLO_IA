import type { CostWarningCode, Material } from '@print3d/api-contracts';

// Copied from the filaments feature on purpose: a feature never imports from another feature.
// A `Record` over a contract type: when the API adds a material, the compiler fails here until
// it has a Spanish label (ADR 0007).
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

export function isMaterial(value: unknown): value is Material {
  return typeof value === 'string' && Object.hasOwn(MATERIAL_LABELS, value);
}

/** Same compile-time guarantee as the materials: a new warning code needs a Spanish message. */
export const WARNING_MESSAGES: Readonly<Record<CostWarningCode, string>> = {
  filament_insufficient: 'La bobina elegida no tiene gramos suficientes para esta cantidad.',
  electricity_printer_not_selected: 'No elegiste una impresora: el costo no incluye electricidad.',
  electricity_printer_power_unknown:
    'La impresora no tiene cargada su potencia: el costo no incluye electricidad.',
  settings_not_configured:
    'Todavía no guardaste tus tarifas: electricidad, desgaste y costo fijo se calculan con ceros.',
};

export function isWarningCode(value: unknown): value is CostWarningCode {
  return typeof value === 'string' && Object.hasOwn(WARNING_MESSAGES, value);
}

// ---- Money (ADR 0011) ------------------------------------------------------------------------

/** Same cap as the API: 1,000,000,000 centavos (ARS 10,000,000). */
export const MAX_COST_MINOR = 1_000_000_000;

const PESOS_INPUT = /^(\d{1,8})(?:,(\d{1,2}))?$/;

/**
 * Converts what the user typed ("15000", "15000,5", "0,01") to integer centavos, or null when the
 * text is not a valid amount. Only string and integer arithmetic: never `parseFloat * 100`.
 */
export function parsePesosToMinor(text: string): number | null {
  const match = PESOS_INPUT.exec(text.trim());
  if (match === null) return null;
  const pesos = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const minor = pesos * 100 + cents;
  return minor <= MAX_COST_MINOR ? minor : null;
}

/** The inverse, for filling a form: 1500050 becomes "15000,50", 1500000 "15000". */
export function minorToPesosInput(minor: number): string {
  const pesos = Math.trunc(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(pesos) : `${String(pesos)},${String(cents).padStart(2, '0')}`;
}

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

/** Display only: the division never feeds back into a stored value. */
export function formatMoney(minor: number): string {
  return ARS.format(minor / 100);
}

// ---- Percentages (basis points: 12.5 % is 1250) ---------------------------------------------

/** 1000 % is the API's ceiling for a margin. */
export const MAX_MARGIN_BASIS_POINTS = 100_000;

const PERCENT_INPUT = /^(\d{1,4})(?:[,.](\d{1,2}))?$/;

/** "12,5" becomes 1250. Same string-and-integer approach as the pesos; null when invalid. */
export function parsePercentToBasisPoints(text: string): number | null {
  const match = PERCENT_INPUT.exec(text.trim());
  if (match === null) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints <= MAX_MARGIN_BASIS_POINTS ? basisPoints : null;
}

/** The inverse: 1250 becomes "12,5", 2500 "25", 1 "0,01". */
export function basisPointsToPercentInput(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, '0');
  return fraction === '00' ? String(whole) : `${String(whole)},${fraction.replace(/0$/, '')}`;
}

/** "Margen (25 %)": the same comma convention, for display. */
export function formatPercent(basisPoints: number): string {
  return `${basisPointsToPercentInput(basisPoints)} %`;
}
