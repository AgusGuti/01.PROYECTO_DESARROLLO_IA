import type {
  Optimization,
  OptimizationStrategy,
  SimulationWarningCode,
} from '@print3d/api-contracts';

export const HORIZON_DAYS = 14;
const MINUTE_MS = 60_000;
const QUARTER_MS = 15 * MINUTE_MS;
const ARGENTINA_OFFSET_MS = 3 * 60 * MINUTE_MS;

export const WARNING_MESSAGES: Readonly<Record<SimulationWarningCode, string>> = {
  part_deleted: 'Hay piezas eliminadas en la cola: no se incluyeron en la simulación.',
  printer_unavailable:
    'Alguna impresora de la cola ya no está disponible: no se usó en la simulación.',
  availability_not_configured:
    'Todavía no cargaste tus ventanas de intervención: sin ellas no se puede ubicar ningún trabajo.',
  nothing_to_print: 'La cola no tiene unidades pendientes para imprimir.',
  batching_applied: 'Se agruparon piezas iguales en una misma placa.',
};

/** A `Record` over the contract type: a new strategy fails to compile until it has a label. */
export const STRATEGY_LABELS: Readonly<Record<OptimizationStrategy, string>> = {
  naive: 'Orden simple',
  queue_order: 'Orden de la cola agrupando piezas',
  longest_first: 'Las más largas primero',
  shortest_first: 'Las más cortas primero',
  best_fit: 'Mejor encaje con tus ventanas',
};

export function isStrategy(value: unknown): value is OptimizationStrategy {
  return typeof value === 'string' && Object.hasOwn(STRATEGY_LABELS, value);
}

export const GOAL_LABELS: Readonly<Record<Optimization['goal'], string>> = {
  deadline: 'cumplir la fecha límite',
  fastest: 'terminar lo antes posible',
  minimal_idle: 'tener el menor tiempo muerto',
};

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Current Argentina time (fixed UTC-3, no DST), rounded up to the next quarter hour; an exact
 * quarter stays. Uses UTC getters on a shifted instant so the browser zone never matters.
 */
export function defaultStart(nowMs: number): { date: string; time: string } {
  const shifted = new Date(Math.ceil((nowMs - ARGENTINA_OFFSET_MS) / QUARTER_MS) * QUARTER_MS);
  return {
    date: `${pad(shifted.getUTCDate())}-${pad(shifted.getUTCMonth() + 1)}-${String(shifted.getUTCFullYear())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

/** DD-MM-AAAA to YYYY-MM-DD, or null when it is not a real date in 2000 to 2099 (the API range). */
export function parseDate(text: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text.trim());
  if (match === null) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const real =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  return real && year >= 2000 && year <= 2099 ? `${String(year)}-${pad(month)}-${pad(day)}` : null;
}

/** HH:MM (24 h) to the same text, or null. */
export function parseTime(text: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  return match === null ? null : `${match[1] ?? ''}:${match[2] ?? ''}`;
}

/** 'YYYY-MM-DDTHH:mm' to 'DD-MM-AAAA HH:MM' by splitting; anything else is returned as is. */
export function formatDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  return match === null
    ? value
    : `${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''} ${match[4] ?? ''}`;
}

/** 'YYYY-MM-DD' to 'DD-MM-AAAA'. */
export function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match === null ? value : `${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}`;
}

/** The deadline cell of a plan: the date and whether it is met. */
export function deadlineText({ date, met }: { date: string | null; met: boolean | null }): string {
  if (date === null) return 'Sin fecha límite';
  if (met === null) return `${formatDate(date)}: sin trabajos ubicados para evaluar`;
  return `${formatDate(date)}: ${met ? 'cumple' : 'no cumple'}`;
}

/** The comparison deltas are optimised minus baseline, so a negative number is an improvement. */
export function finishDeltaText(delta: number | null): string {
  if (delta === null) return 'No se puede comparar la hora de fin.';
  if (delta === 0) return 'Sin diferencia en la hora de fin.';
  return `Termina ${formatMinutes(Math.abs(delta))} ${delta < 0 ? 'antes' : 'después'}.`;
}

export function idleDeltaText(delta: number): string {
  if (delta === 0) return 'Sin diferencia en el tiempo muerto.';
  return `Tiempo muerto: ${formatMinutes(Math.abs(delta))} ${delta < 0 ? 'menos' : 'más'}.`;
}

export const DEADLINE_CHANGE_TEXT: Readonly<
  Record<Optimization['comparison']['deadlineChanged'], string>
> = {
  gained: 'Ahora cumple la fecha límite.',
  lost: 'Ya no cumple la fecha límite.',
  same: 'La fecha límite queda igual.',
  unknown: 'No se puede comparar la fecha límite.',
};

/** 150 becomes "2 h 30 min". */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** Minutes since the epoch of a wall-clock 'YYYY-MM-DDTHH:mm' (zone-free, for differences only). */
export function wallMinutes(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return Number.NaN;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute) / MINUTE_MS;
}
