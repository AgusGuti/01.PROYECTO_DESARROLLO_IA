import type { Material, Project } from '@print3d/api-contracts';

export type Priority = Project['priority'];

// A `Record` over a contract type: when the API adds a value, the compiler fails here until it
// has a Spanish label (ADR 0007).
export const PRIORITY_LABELS: Readonly<Record<Priority, string>> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

/** Option order for the selects, from the least to the most urgent. */
export const PRIORITY_ORDER: readonly Priority[] = ['low', 'normal', 'high', 'urgent'];

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && Object.hasOwn(PRIORITY_LABELS, value);
}

// Copied from the parts feature on purpose: a feature never imports from another feature.
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

// ---- Calendar days ---------------------------------------------------------------------------

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-11-30" becomes "30/11/2026". The string is split, never parsed as a `Date`: a deadline
 * is a calendar day with no time zone, and `new Date('2026-11-30')` is UTC midnight, which is the
 * previous day west of Greenwich.
 */
export function formatDeadline(deadline: string): string {
  const match = CALENDAR_DAY.exec(deadline);
  return match === null ? deadline : `${match[3] ?? ''}/${match[2] ?? ''}/${match[1] ?? ''}`;
}

const pad = (value: number, length: number): string => String(value).padStart(length, '0');

/** Today's calendar day as YYYY-MM-DD, from the browser's LOCAL date parts. */
export function todayLocal(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/** Strictly before today. Both are fixed-width YYYY-MM-DD, so string order is calendar order. */
export function isOverdue(deadline: string | null, today: string): boolean {
  return deadline !== null && deadline < today;
}

/** The API accepts years 2000..2099 (ADR 0011); the form mirrors it as a convenience. */
export const MIN_DEADLINE = '2000-01-01';
export const MAX_DEADLINE = '2099-12-31';

export function isDeadlineInRange(value: string): boolean {
  return CALENDAR_DAY.test(value) && value >= MIN_DEADLINE && value <= MAX_DEADLINE;
}

// ---- Plurals ---------------------------------------------------------------------------------

export function linesAndUnits(lines: number, units: number): string {
  return `${String(lines)} ${lines === 1 ? 'línea' : 'líneas'} · ${String(units)} ${
    units === 1 ? 'unidad' : 'unidades'
  }`;
}
