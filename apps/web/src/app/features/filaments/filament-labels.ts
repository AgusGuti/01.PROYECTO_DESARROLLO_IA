import type { Filament, Material } from '@print3d/api-contracts';

// A `Record` over a contract type: when the API adds a material, the compiler fails here until
// it has a Spanish label (ADR 0007). Copied from the printers feature on purpose: a feature
// never imports from another feature.
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

// Option order for the selects. Completeness is checked by a test against the label table.
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

export function isMaterial(value: unknown): value is Material {
  return typeof value === 'string' && Object.hasOwn(MATERIAL_LABELS, value);
}

// ---- Stock indicator -------------------------------------------------------------------------

export type StockLevel = 'none' | 'low' | 'ok';

/** Text and a symbol: the level is never conveyed by colour alone. */
export const STOCK_LABELS: Readonly<Record<StockLevel, { text: string; icon: string }>> = {
  none: { text: 'Sin stock', icon: '✕' },
  low: { text: 'Poco stock', icon: '⚠' },
  ok: { text: 'Disponible', icon: '✓' },
};

/** Empty is 0 g; low is 20% or less of the spool (integer arithmetic, no rounding). */
export function stockLevel(
  filament: Pick<Filament, 'initialGrams' | 'availableGrams'>,
): StockLevel {
  if (filament.availableGrams === 0) return 'none';
  return filament.availableGrams * 5 <= filament.initialGrams ? 'low' : 'ok';
}

// ---- Money (ADR 0011) ------------------------------------------------------------------------

/** Same cap as the API: 1,000,000,000 centavos (ARS 10,000,000). */
export const MAX_COST_MINOR = 1_000_000_000;

const PESOS_INPUT = /^(\d{1,8})(?:,(\d{1,2}))?$/;

/**
 * Converts what the user typed ("15000", "15000,5", "0,01") to integer centavos, or null when the
 * text is not a valid amount. Only string and integer arithmetic: never `parseFloat * 100`, which
 * gives 1500049.9999999998 for some inputs. No thousands separator is accepted.
 */
export function parsePesosToMinor(text: string): number | null {
  const match = PESOS_INPUT.exec(text.trim());
  if (match === null) return null;
  const pesos = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const minor = pesos * 100 + cents;
  return minor <= MAX_COST_MINOR ? minor : null;
}

/** The inverse, for filling the edit form: 1500050 becomes "15000,50", 1500000 "15000". */
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

// ---- Calendar dates (ADR 0011) ---------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar day written as YYYY-MM-DD (2026-02-30 is not). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

/**
 * "2026-10-01" becomes "01/10/2026" by splitting the text. `new Date('2026-10-01')` is midnight
 * UTC, which a browser in Argentina (UTC-3) would show as the 30th of September.
 */
export function formatDate(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  return match === null ? isoDate : `${match[3]}/${match[2]}/${match[1]}`;
}

/** Today's UTC date as YYYY-MM-DD: the latest purchase date the API accepts (ADR 0011). */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
