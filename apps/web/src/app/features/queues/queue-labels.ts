import type { Queue } from '@print3d/api-contracts';

export type Goal = Queue['goal'];
export type Mode = Queue['mode'];

export const GOALS: readonly { readonly value: Goal; readonly label: string }[] = [
  { value: 'deadline', label: 'Cumplir las fechas límite' },
  { value: 'fastest', label: 'Terminar lo antes posible' },
  { value: 'minimal_idle', label: 'Minimizar tiempos muertos' },
];

export const MODES: readonly { readonly value: Mode; readonly label: string }[] = [
  { value: 'single', label: 'Una impresora' },
  { value: 'multi', label: 'Varias impresoras' },
];

export const MIN_MULTI_PRINTERS = 2;
export const MAX_PRINTERS = 10;
export const MAX_QUANTITY = 1000;

export function isGoal(value: unknown): value is Goal {
  return GOALS.some((goal) => goal.value === value);
}

export function isMode(value: unknown): value is Mode {
  return MODES.some((mode) => mode.value === value);
}

/** Display only: 9000 s becomes "2 h 30 min". */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

/** Whole numbers 1..1000 only; anything else is null. */
export function parseQuantity(text: string): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_QUANTITY ? value : null;
}
