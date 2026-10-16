// Business rules of the print-order optimiser (CU08, ADR 0027, 0028): pure functions, no I/O.
// It is an explainable greedy heuristic: several simple strategies are evaluated with the same
// scheduler and the best one for the queue's goal wins. `naive` (the CU10 result) is always among
// them and wins ties, so the answer is never worse than the baseline by construction.
import type { ScheduleRules } from '../availability/index.js';
import {
  createTimeline,
  deadlineMet,
  HORIZON_DAYS,
  MINUTES_PER_DAY,
  minutesOf,
  simulateNaive,
  type Goal,
  type SimulatedPrinter,
  type Simulation,
  type SimulationLine,
  type Timeline,
} from './simulations.domain.js';

export const STRATEGIES = [
  'naive',
  'queue_order',
  'longest_first',
  'shortest_first',
  'best_fit',
] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** Free space kept around each piece, in millimetres, and the share of the bed that may be used. */
const MARGIN_MM = 10;
const MAX_PIECES_PER_PLATE = 20;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * How many identical pieces fit on one plate of this printer (ADR 0027): the largest N with
 * N * (x + 10) * (y + 10) <= 90 % of the bed area and N cells of (x + 10) by (y + 10) fit the
 * bed as a grid (either orientation), provided one piece fits the bed with its
 * margin and is not taller than the build height. Between 1 and 20: a piece that does not fit
 * at all is still planned alone, as the naive planner does.
 */
export function plateCapacity(part: Box, bed: Box): number {
  const cellX = part.x + MARGIN_MM;
  const cellY = part.y + MARGIN_MM;
  if (cellX > bed.x || cellY > bed.y || part.z > bed.z) return 1;
  // 0.9 * bed area, compared in integers: 10 * N * cell <= 9 * bed area.
  const byArea = Math.floor((9 * bed.x * bed.y) / (10 * cellX * cellY));
  // A grid of whole cells must also exist, in either orientation of the piece.
  const byGrid = Math.max(
    Math.floor(bed.x / cellX) * Math.floor(bed.y / cellY),
    Math.floor(bed.x / cellY) * Math.floor(bed.y / cellX),
  );
  return Math.min(MAX_PIECES_PER_PLATE, Math.max(1, Math.min(byArea, byGrid)));
}

/**
 * Minutes a plate of `pieces` identical pieces takes: ceil(n * seconds * (10000 - saving) / 10000
 * / 60) with exact integer arithmetic. One piece never gets the saving, so it equals the single
 * print time of the naive planner.
 */
export function plateMinutes(seconds: number, pieces: number, savingBasisPoints: number): number {
  if (pieces <= 1) return minutesOf(seconds);
  const numerator = pieces * seconds * (10_000 - savingBasisPoints);
  const denominator = 600_000;
  return Math.max(1, Math.floor((numerator + denominator - 1) / denominator));
}

export interface OptimizerLine {
  readonly partId: string;
  /** Units still to print. */
  readonly units: number;
  readonly seconds: number;
  readonly size: Box;
}

export interface OptimizerPrinter {
  readonly printerId: string;
  readonly bed: Box;
}

export interface Plate {
  readonly order: number;
  readonly partId: string;
  /** Pieces on this plate. */
  readonly units: number;
  readonly plateIndex: number;
  readonly platesInLine: number;
  readonly printerId: string;
  readonly start: number;
  readonly end: number;
  readonly handoff: number;
  readonly unattended: boolean;
}

export interface Plan {
  readonly jobs: readonly Plate[];
  readonly printers: readonly SimulatedPrinter[];
  readonly unplaced: readonly { partId: string; units: number }[];
  readonly finishAt: number | null;
}

export interface PlanMetrics {
  readonly finishAt: number | null;
  readonly totalIdleMinutes: number;
  readonly placedUnits: number;
  readonly unplacedUnits: number;
  /** null without a deadline or with nothing to place. */
  readonly deadlineMet: boolean | null;
}

export interface OptimizerInput {
  readonly schedule: ScheduleRules;
  readonly startAt: number;
  readonly lines: readonly OptimizerLine[];
  readonly printers: readonly OptimizerPrinter[];
  readonly batchSavingBasisPoints: number;
  readonly goal: Goal;
  /** `YYYY-MM-DD` or null. */
  readonly deadline: string | null;
}

export interface Candidate {
  readonly strategy: Strategy;
  readonly plan: Plan;
  readonly metrics: PlanMetrics;
}

export interface Optimization {
  readonly strategy: Strategy;
  readonly baseline: Candidate;
  readonly optimized: Candidate;
  readonly candidates: readonly Candidate[];
}

export function metricsOf(plan: Plan, deadline: string | null): PlanMetrics {
  const unplacedUnits = plan.unplaced.reduce((sum, entry) => sum + entry.units, 0);
  return {
    finishAt: plan.finishAt,
    totalIdleMinutes: plan.printers.reduce((sum, printer) => sum + printer.idleMinutes, 0),
    placedUnits: plan.jobs.reduce((sum, job) => sum + job.units, 0),
    unplacedUnits,
    deadlineMet: deadlineMet(deadline, plan.finishAt, unplacedUnits),
  };
}

/** The naive result seen as a plan of one-piece plates, so every strategy has the same shape. */
function planOfNaive(simulation: Simulation): Plan {
  return {
    jobs: simulation.jobs.map((job) => ({
      order: job.order,
      partId: job.partId,
      units: 1,
      plateIndex: job.unit,
      platesInLine: job.unitsInLine,
      printerId: job.printerId,
      start: job.start,
      end: job.end,
      handoff: job.handoff,
      unattended: job.unattended,
    })),
    printers: simulation.printers,
    unplaced: simulation.unplaced,
    finishAt: simulation.finishAt,
  };
}

interface LineState {
  readonly line: OptimizerLine;
  remaining: number;
  plates: number;
}

interface Option {
  readonly state: LineState;
  readonly pieces: number;
  readonly minutes: number;
}

/** Score of an option under a strategy: lexicographic, lower is better. */
type Score = (option: Option, start: number, timeline: Timeline) => readonly number[];

const SCORES: Record<Exclude<Strategy, 'naive'>, Score> = {
  queue_order: () => [0],
  longest_first: (option) => [-option.minutes],
  shortest_first: (option) => [option.minutes],
  // Minimise the wait between the end of the plate and its collection; a longer plate wins a tie.
  // A plate that could never be collected is the worst choice.
  best_fit: (option, start, timeline) => {
    const end = start + option.minutes;
    const handoff = timeline.handoffFor(end);
    return [handoff === null ? Number.MAX_SAFE_INTEGER : handoff - end, -option.minutes];
  },
};

/** The best-scoring option; a tie keeps the earlier one, which is the earlier queue line. */
function choose(options: readonly Option[], score: (option: Option) => readonly number[]): Option {
  let best = options[0];
  if (best === undefined) throw new Error('no option to choose from');
  let bestScore = score(best);
  for (const option of options.slice(1)) {
    const value = score(option);
    if (compareKeys(value, bestScore) < 0) {
      best = option;
      bestScore = value;
    }
  }
  return best;
}

/** Runs one strategy with the shared scheduler (earliest-free printer, 14-day horizon). */
function schedulePlates(
  input: OptimizerInput,
  strategy: Exclude<Strategy, 'naive'>,
  timeline: Timeline,
): Plan {
  const limit = input.startAt + HORIZON_DAYS * MINUTES_PER_DAY;
  const states: LineState[] = input.lines
    .filter((line) => line.units > 0)
    .map((line) => ({ line, remaining: line.units, plates: 0 }));
  const printers = input.printers.map((printer) => ({
    ...printer,
    free: input.startAt,
    jobs: 0,
    busy: 0,
    idle: 0,
  }));
  const placed: (Omit<Plate, 'platesInLine'> & { lineIndex: number })[] = [];
  const unplaced = new Map<string, number>();

  for (;;) {
    const open = states.filter((state) => state.remaining > 0);
    if (open.length === 0) break;
    // Strict "<" keeps the first printer of the list on a tie.
    const printer = printers.reduce((best, candidate) =>
      candidate.free < best.free ? candidate : best,
    );
    const start = timeline.nextIntervention(printer.free, limit);
    if (start === null) {
      // Nothing more can start in the horizon: everything left is unplaced.
      for (const state of open) {
        unplaced.set(state.line.partId, (unplaced.get(state.line.partId) ?? 0) + state.remaining);
        state.remaining = 0;
      }
      break;
    }
    const options = open.map((state): Option => {
      const pieces = Math.min(state.remaining, plateCapacity(state.line.size, printer.bed));
      return {
        state,
        pieces,
        minutes: plateMinutes(state.line.seconds, pieces, input.batchSavingBasisPoints),
      };
    });
    const score = SCORES[strategy];
    const chosen = choose(options, (option) => score(option, start, timeline));
    const { state, pieces, minutes } = chosen;
    state.remaining -= pieces;
    const end = start + minutes;
    const handoff = timeline.handoffFor(end);
    if (handoff === null) {
      unplaced.set(state.line.partId, (unplaced.get(state.line.partId) ?? 0) + pieces);
      continue;
    }
    printer.busy += end - start;
    printer.idle += handoff - end;
    printer.jobs += 1;
    printer.free = handoff;
    state.plates += 1;
    placed.push({
      order: placed.length + 1,
      lineIndex: states.indexOf(state),
      partId: state.line.partId,
      units: pieces,
      plateIndex: state.plates,
      printerId: printer.printerId,
      start,
      end,
      handoff,
      unattended: timeline.interventionMinutes(start, end) < end - start,
    });
  }

  return {
    jobs: placed.map(({ lineIndex, ...plate }) => ({
      ...plate,
      platesInLine: states[lineIndex]?.plates ?? plate.plateIndex,
    })),
    printers: printers.map(({ printerId, jobs, busy, idle }) => ({
      printerId,
      jobs,
      busyMinutes: busy,
      idleMinutes: idle,
    })),
    unplaced: [...unplaced].map(([partId, units]) => ({ partId, units })),
    finishAt: placed.reduce<number | null>((last, job) => Math.max(last ?? 0, job.handoff), null),
  };
}

/** Comparison key of a goal: lexicographic, lower is better. Unplaced work is always worst. */
export function goalKey(goal: Goal, metrics: PlanMetrics): readonly number[] {
  const finish = metrics.finishAt ?? 0;
  const missed = metrics.deadlineMet === false ? 1 : 0;
  switch (goal) {
    case 'fastest':
      return [metrics.unplacedUnits, finish, metrics.totalIdleMinutes];
    case 'minimal_idle':
      return [metrics.unplacedUnits, metrics.totalIdleMinutes, finish];
    case 'deadline':
      return [missed, metrics.unplacedUnits, finish, metrics.totalIdleMinutes];
  }
}

/** Negative when `a` is better than `b`. */
export function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Evaluates every strategy and picks the best for the goal; the earlier one wins a tie. */
export function optimize(input: OptimizerInput): Optimization {
  const timeline = createTimeline(input.schedule);
  const naivePlan = planOfNaive(
    simulateNaive({
      schedule: input.schedule,
      startAt: input.startAt,
      lines: input.lines.map((line): SimulationLine => ({
        partId: line.partId,
        units: line.units,
        minutes: minutesOf(line.seconds),
      })),
      printerIds: input.printers.map((printer) => printer.printerId),
    }),
  );
  const candidates: Candidate[] = STRATEGIES.map((strategy) => {
    const plan = strategy === 'naive' ? naivePlan : schedulePlates(input, strategy, timeline);
    return { strategy, plan, metrics: metricsOf(plan, input.deadline) };
  });
  const [baseline] = candidates;
  if (baseline === undefined) throw new Error('the naive candidate is always present');
  let best = baseline;
  for (const candidate of candidates.slice(1)) {
    if (
      compareKeys(goalKey(input.goal, candidate.metrics), goalKey(input.goal, best.metrics)) < 0
    ) {
      best = candidate;
    }
  }
  return { strategy: best.strategy, baseline, optimized: best, candidates };
}

/** Did the deadline outcome change between the baseline and the optimised plan? */
export function deadlineChange(
  baseline: boolean | null,
  optimized: boolean | null,
): 'gained' | 'lost' | 'same' | 'unknown' {
  if (baseline === null || optimized === null) return 'unknown';
  if (baseline === optimized) return 'same';
  return optimized ? 'gained' : 'lost';
}
