// Business rules of the planning simulation (CU10), pure functions with no I/O (ADR 0026).
// Time is an integer count of wall-clock minutes of America/Argentina/Buenos_Aires since
// 1970-01-01 00:00 of that zone. There is no daylight saving, so plain integer arithmetic is exact.
import { interventionRangesFor, type ScheduleRules } from '../availability/index.js';

export const MINUTES_PER_DAY = 1440;
export const HORIZON_DAYS = 14;
export const MAX_UNITS = 1000;
/** How far past the end of a print the search for a handoff minute goes before giving up. */
const HANDOFF_SEARCH_DAYS = 60;
const MS_PER_DAY = 86_400_000;

export const SIMULATION_WARNING_CODES = [
  'part_deleted',
  'printer_unavailable',
  'availability_not_configured',
  'nothing_to_print',
] as const;
export type SimulationWarningCode = (typeof SIMULATION_WARNING_CODES)[number];

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * `YYYY-MM-DDTHH:mm` (a real calendar day in 2000..2099) to minutes since the epoch day, or null.
 * `Date.UTC` is used only as a calendar calculator; no local time zone is involved.
 */
export function parseLocalMinutes(value: string): number | null {
  const match = LOCAL_PATTERN.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  if (year < 2000 || year > 2099 || hour > 23 || minute > 59) return null;
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return (ms / MS_PER_DAY) * MINUTES_PER_DAY + hour * 60 + minute;
}

/** The calendar day `YYYY-MM-DD` of a minute count. */
export function dateOf(minutes: number): string {
  return new Date(Math.floor(minutes / MINUTES_PER_DAY) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `YYYY-MM-DDTHH:mm` of a minute count. */
export function formatLocalMinutes(minutes: number): string {
  const within = minutes - Math.floor(minutes / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  return `${dateOf(minutes)}T${pad(Math.floor(within / 60))}:${pad(within % 60)}`;
}

export interface SimulationLine {
  readonly partId: string;
  /** Units still to print: quantity - completed. */
  readonly units: number;
  readonly minutes: number;
}

export interface SimulatedJob {
  readonly order: number;
  readonly partId: string;
  readonly unit: number;
  readonly unitsInLine: number;
  readonly printerId: string;
  readonly start: number;
  readonly end: number;
  readonly handoff: number;
  readonly unattended: boolean;
}

export interface SimulatedPrinter {
  readonly printerId: string;
  readonly jobs: number;
  readonly busyMinutes: number;
  readonly idleMinutes: number;
}

export interface Simulation {
  readonly jobs: readonly SimulatedJob[];
  readonly printers: readonly SimulatedPrinter[];
  readonly unplaced: readonly { partId: string; units: number }[];
  /** The last handoff, or null when nothing was placed. */
  readonly finishAt: number | null;
}

/** Print time in whole minutes, at least one. */
export const minutesOf = (seconds: number): number => Math.max(1, Math.ceil(seconds / 60));

/** Intervention ranges of a calendar day as absolute minutes, memoised per simulation. */
function rangesByDay(
  schedule: ScheduleRules,
): (day: number) => readonly (readonly [number, number])[] {
  const cache = new Map<number, readonly (readonly [number, number])[]>();
  return (day) => {
    let found = cache.get(day);
    if (found === undefined) {
      const base = day * MINUTES_PER_DAY;
      found = interventionRangesFor(schedule, dateOf(base)).map(
        (range) => [base + range.startMinute, base + range.endMinute] as const,
      );
      cache.set(day, found);
    }
    return found;
  };
}

interface PrinterState {
  readonly printerId: string;
  free: number;
  jobs: number;
  busy: number;
  idle: number;
}

/**
 * Naive planning: one job per remaining unit, in queue-line order; each goes to the printer that
 * is free earliest (a tie goes to the first in `printerIds`). A print starts and is collected only
 * at intervention minutes (end-exclusive). A unit that would start after the 14-day horizon, or
 * whose piece could never be collected, is reported as unplaced.
 */
export function simulateNaive(input: {
  schedule: ScheduleRules;
  startAt: number;
  lines: readonly SimulationLine[];
  printerIds: readonly string[];
}): Simulation {
  const { startAt, lines, printerIds } = input;
  const dayRanges = rangesByDay(input.schedule);
  const limit = startAt + HORIZON_DAYS * MINUTES_PER_DAY;

  /** First intervention minute >= from and <= until, or null. */
  const nextIntervention = (from: number, until: number): number | null => {
    const lastDay = Math.floor(until / MINUTES_PER_DAY);
    for (let day = Math.floor(from / MINUTES_PER_DAY); day <= lastDay; day++) {
      for (const [start, end] of dayRanges(day)) {
        if (end <= from) continue;
        const candidate = Math.max(start, from);
        return candidate <= until ? candidate : null;
      }
    }
    return null;
  };

  /** Minutes of [from, to) in which the user can intervene. */
  const interventionMinutes = (from: number, to: number): number => {
    let total = 0;
    const lastDay = Math.floor((to - 1) / MINUTES_PER_DAY);
    for (let day = Math.floor(from / MINUTES_PER_DAY); day <= lastDay; day++) {
      for (const [start, end] of dayRanges(day)) {
        total += Math.max(0, Math.min(end, to) - Math.max(start, from));
      }
    }
    return total;
  };

  const state: PrinterState[] = printerIds.map((printerId) => ({
    printerId,
    free: startAt,
    jobs: 0,
    busy: 0,
    idle: 0,
  }));
  const jobs: SimulatedJob[] = [];
  const unplaced = new Map<string, number>();

  for (const line of lines) {
    for (let unit = 1; unit <= line.units; unit++) {
      // Strict "<" keeps the first printer of the list on a tie.
      const printer = state.reduce((best, candidate) =>
        candidate.free < best.free ? candidate : best,
      );
      const start = nextIntervention(printer.free, limit);
      const end = start === null ? 0 : start + line.minutes;
      const handoff =
        start === null ? null : nextIntervention(end, end + HANDOFF_SEARCH_DAYS * MINUTES_PER_DAY);
      if (start === null || handoff === null) {
        unplaced.set(line.partId, (unplaced.get(line.partId) ?? 0) + 1);
        continue;
      }
      printer.busy += end - start;
      printer.idle += handoff - end;
      printer.jobs += 1;
      printer.free = handoff;
      jobs.push({
        order: jobs.length + 1,
        partId: line.partId,
        unit,
        unitsInLine: line.units,
        printerId: printer.printerId,
        start,
        end,
        handoff,
        // Some minute of the print has nobody able to attend (typically the night).
        unattended: interventionMinutes(start, end) < end - start,
      });
    }
  }

  return {
    jobs,
    printers: state.map(({ printerId, jobs: count, busy, idle }) => ({
      printerId,
      jobs: count,
      busyMinutes: busy,
      idleMinutes: idle,
    })),
    unplaced: [...unplaced].map(([partId, units]) => ({ partId, units })),
    finishAt: jobs.reduce<number | null>((last, job) => Math.max(last ?? 0, job.handoff), null),
  };
}

/** Deadline met: everything placed and the last handoff is on or before the deadline day. */
export function deadlineMet(
  deadline: string | null,
  finishAt: number | null,
  unplacedUnits: number,
): boolean | null {
  if (deadline === null) return null;
  if (unplacedUnits > 0) return false;
  return finishAt === null ? null : dateOf(finishAt) <= deadline;
}
