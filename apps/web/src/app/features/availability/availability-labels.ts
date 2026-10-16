export const DAY_NAMES: readonly string[] = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

/** Limits of the contract (ADR 0024); the form mirrors them as a convenience. */
export const MAX_RANGES_PER_DAY = 6;
export const MAX_EXCEPTIONS = 60;
export const END_OF_DAY = 1440;

const TIME = /^(\d{1,2}):(\d{2})$/;

/**
 * "08:00" to minutes since midnight. "24:00" (1440) is accepted only when `isEnd` is true,
 * because a range cannot start at the end of the day. Null if the text is not a valid time.
 */
export function parseTime(text: string, isEnd: boolean): number | null {
  const match = TIME.exec(text.trim());
  if (match === null) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[2]) > 59) return null;
  if (minutes === END_OF_DAY) return isEnd ? minutes : null;
  return Number(match[1]) <= 23 ? minutes : null;
}

/** Minutes since midnight to "HH:MM"; 1440 is "24:00". */
export function formatMinutes(minutes: number): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// Copied from the projects feature on purpose: a feature never imports from another feature.
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-11-30" to "30-11-2026". Split, never parsed as a `Date` (no time-zone shift). */
export function formatDay(day: string): string {
  const match = CALENDAR_DAY.exec(day);
  return match === null ? day : `${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}`;
}

const DMY_DAY = /^(\d{2})-(\d{2})-(\d{4})$/;

/** DD-MM-YYYY back to YYYY-MM-DD; null if it is not a real calendar day in 2000..2099. */
export function parseDay(text: string): string | null {
  const match = DMY_DAY.exec(text.trim());
  if (match === null) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const real =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  return real && year >= 2000 && year <= 2099
    ? `${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}`
    : null;
}
