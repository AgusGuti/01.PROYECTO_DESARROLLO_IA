import { describe, expect, it } from 'vitest';
import type { ScheduleRules } from '../availability/index.js';
import {
  createTimeline,
  formatLocalMinutes,
  HORIZON_DAYS,
  MINUTES_PER_DAY,
  minutesOf,
  parseLocalMinutes,
  simulateNaive,
  type Goal,
} from './simulations.domain.js';
import {
  compareKeys,
  deadlineChange,
  goalKey,
  optimize,
  plateCapacity,
  plateMinutes,
  type Box,
  type Optimization,
  type OptimizerInput,
  type OptimizerLine,
  type PlanMetrics,
  type Plan,
} from './simulations.optimizer.js';
import { DAY_SHIFT, ENDER_BED } from './testing/fakes.js';

// 2026-03-02 is a Monday. DAY_SHIFT allows intervention 08:00-18:00 every day (18:00 excluded).
const at = (value: string): number => {
  const parsed = parseLocalMinutes(value);
  if (parsed === null) throw new Error(`bad test time ${value}`);
  return parsed;
};
const text = (minutes: number): string => formatLocalMinutes(minutes);
const MONDAY_8 = '2026-03-02T08:00';
const BIG: Box = { x: 210, y: 100, z: 50 }; // never shares a plate with another piece
const SMALL: Box = { x: 40, y: 40, z: 20 }; // 16 on an Ender bed

const line = (partId: string, units: number, hours: number, size: Box = BIG): OptimizerLine => ({
  partId,
  units,
  seconds: hours * 3600,
  size,
});

const run = (
  lines: OptimizerLine[],
  options: Partial<OptimizerInput> & { start?: string } = {},
): Optimization =>
  optimize({
    schedule: DAY_SHIFT,
    startAt: at(options.start ?? MONDAY_8),
    lines,
    printers: [{ printerId: 'A', bed: ENDER_BED }],
    batchSavingBasisPoints: 0,
    goal: 'fastest',
    deadline: null,
    ...options,
  });

const candidate = (result: Optimization, strategy: string) => {
  const found = result.candidates.find((entry) => entry.strategy === strategy);
  if (found === undefined) throw new Error(`no candidate ${strategy}`);
  return found;
};
const rows = (plan: Plan) =>
  plan.jobs.map((job) => [
    job.partId,
    job.units,
    text(job.start),
    text(job.end),
    text(job.handoff),
  ]);

describe('plateCapacity (Ender-3 V2 Neo bed 220 x 220 x 250)', () => {
  it.each([
    // 3 * 110 * 110 = 36300 <= 43560 (90 % of 48400) but 4 * 12100 = 48400 is not.
    ['100 x 100', { x: 100, y: 100, z: 30 }, 3],
    // Area allows 17 (17 * 2500 = 42500 <= 43560) but a grid of 50 mm cells is 4 x 4 = 16.
    ['40 x 40', SMALL, 16],
    // Area allows 3 (3 * 14400 = 43200 <= 43560) but only one 120 mm cell fits a 220 mm side.
    ['110 x 110', { x: 110, y: 110, z: 30 }, 1],
    // Grid 3 x 4 = 12 equals the area bound 12; rotation gives 4 x 3, the same.
    ['60 x 40', { x: 60, y: 40, z: 30 }, 12],
    // One piece: 220 x 110 fits the 220 side exactly; two would need 48400 > 43560.
    ['210 x 100', { x: 210, y: 100, z: 30 }, 1],
    // 211 + 10 = 221 > 220: it does not fit the side, so it is planned alone.
    ['211 x 100', { x: 211, y: 100, z: 30 }, 1],
    // Taller than the build height: planned alone.
    ['100 x 100 x 251', { x: 100, y: 100, z: 251 }, 1],
    // Exactly the build height is fine.
    ['100 x 100 x 250', { x: 100, y: 100, z: 250 }, 3],
    // 193 would fit by area; the cap is 20.
    ['5 x 5', { x: 5, y: 5, z: 5 }, 20],
  ])('%s gives %i', (_label, part, expected) => {
    expect(plateCapacity(part, ENDER_BED)).toBe(expected);
  });

  it('depends on the printer that receives the plate', () => {
    // 300 x 300: area allows 6 (6 * 12100 = 72600 <= 81000) but the grid is 2 x 2 = 4.
    expect(plateCapacity({ x: 100, y: 100, z: 30 }, { x: 300, y: 300, z: 400 })).toBe(4);
  });
});

describe('plateMinutes', () => {
  it.each([
    // [seconds, pieces, basis points, minutes]
    [3600, 1, 0, 60],
    [3600, 1, 3000, 60], // one piece never gets the saving
    [3600, 2, 0, 120],
    [3600, 3, 1000, 162], // 3 * 3600 * 0.9 / 60
    [3600, 2, 5000, 60], // the largest saving: half
    [3601, 2, 0, 121], // 120.03 rounds up
    [7200, 6, 3000, 504],
    [0, 3, 0, 1], // at least a minute
  ])('%i s x %i pieces with %i bp is %i min', (seconds, pieces, bp, expected) => {
    expect(plateMinutes(seconds, pieces, bp)).toBe(expected);
  });
});

describe('batching', () => {
  it('splits 20 identical pieces into a full plate of 16 and a remainder of 4', () => {
    const result = run([{ partId: 'p', units: 20, seconds: 600, size: SMALL }]);

    const plan = candidate(result, 'queue_order').plan;
    expect(plan.jobs.map((job) => [job.units, job.plateIndex, job.platesInLine])).toEqual([
      [16, 1, 2],
      [4, 2, 2],
    ]);
    // 16 * 10 min = 160 min, then 4 * 10 min = 40 min.
    expect(rows(plan)).toEqual([
      ['p', 16, '2026-03-02T08:00', '2026-03-02T10:40', '2026-03-02T10:40'],
      ['p', 4, '2026-03-02T10:40', '2026-03-02T11:20', '2026-03-02T11:20'],
    ]);
  });

  it('uses the capacity of the printer that receives each plate', () => {
    const part = { x: 100, y: 100, z: 30 };
    const result = run([{ partId: 'p', units: 7, seconds: 3600, size: part }], {
      printers: [
        { printerId: 'small', bed: ENDER_BED }, // 3 per plate
        { printerId: 'large', bed: { x: 300, y: 300, z: 400 } }, // 4 per plate
      ],
    });

    const plan = candidate(result, 'queue_order').plan;
    expect(plan.jobs.map((job) => [job.printerId, job.units])).toEqual([
      ['small', 3],
      ['large', 4],
    ]);
    expect(rows(plan)).toEqual([
      ['p', 3, '2026-03-02T08:00', '2026-03-02T11:00', '2026-03-02T11:00'],
      ['p', 4, '2026-03-02T08:00', '2026-03-02T12:00', '2026-03-02T12:00'],
    ]);
  });

  it('never mixes different parts on a plate', () => {
    const result = run([line('a', 3, 1, SMALL), line('b', 2, 1, SMALL)]);

    for (const { plan } of result.candidates) {
      for (const job of plan.jobs) expect(['a', 'b']).toContain(job.partId);
    }
    const plates = candidate(result, 'queue_order').plan.jobs;
    expect(plates.map((job) => [job.partId, job.units])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
  });

  it('reduces the collections and wins a deadline the naive plan misses', () => {
    // Six 2 h pieces, 30 % saving on a shared plate: 6 * 7200 * 0.7 / 60 = 504 min (8 h 24 min).
    const result = run([{ partId: 'p', units: 6, seconds: 7200, size: SMALL }], {
      goal: 'deadline',
      deadline: '2026-03-02',
      batchSavingBasisPoints: 3000,
    });

    // Naive: five prints fill the day, the 16:00-18:00 one is collected on Tuesday morning,
    // then the sixth runs 08:00-10:00.
    expect(result.baseline.plan.jobs).toHaveLength(6);
    expect(text(result.baseline.metrics.finishAt ?? 0)).toBe('2026-03-03T10:00');
    expect(result.baseline.metrics.deadlineMet).toBe(false);
    expect(result.strategy).toBe('queue_order');
    expect(rows(result.optimized.plan)).toEqual([
      ['p', 6, '2026-03-02T08:00', '2026-03-02T16:24', '2026-03-02T16:24'],
    ]);
    expect(result.optimized.metrics.deadlineMet).toBe(true);
    expect(deadlineChange(false, true)).toBe('gained');
  });
});

describe('best_fit against the naive baseline', () => {
  // Queue: 1 h, 1 h, 8 h, 8 h on one printer, from Monday 08:00; intervention 08:00-18:00.
  const queue = () => [line('a', 1, 1), line('b', 1, 1), line('c', 1, 8), line('d', 1, 8)];

  it('naive puts an 8 h print at 10:00, ends at 18:00 (not a handoff minute) and waits 14 h', () => {
    const naive = run(queue()).baseline;

    expect(rows(naive.plan)).toEqual([
      ['a', 1, '2026-03-02T08:00', '2026-03-02T09:00', '2026-03-02T09:00'],
      ['b', 1, '2026-03-02T09:00', '2026-03-02T10:00', '2026-03-02T10:00'],
      ['c', 1, '2026-03-02T10:00', '2026-03-02T18:00', '2026-03-03T08:00'],
      ['d', 1, '2026-03-03T08:00', '2026-03-03T16:00', '2026-03-03T16:00'],
    ]);
    expect(naive.metrics.totalIdleMinutes).toBe(840);
  });

  it('best_fit starts an 8 h print first, runs a 1 h print in the evening and the last 8 h overnight', () => {
    const result = run(queue(), { goal: 'minimal_idle' });

    const best = candidate(result, 'best_fit');
    expect(rows(best.plan)).toEqual([
      ['c', 1, '2026-03-02T08:00', '2026-03-02T16:00', '2026-03-02T16:00'],
      ['a', 1, '2026-03-02T16:00', '2026-03-02T17:00', '2026-03-02T17:00'],
      ['d', 1, '2026-03-02T17:00', '2026-03-03T01:00', '2026-03-03T08:00'],
      ['b', 1, '2026-03-03T08:00', '2026-03-03T09:00', '2026-03-03T09:00'],
    ]);
    expect(best.plan.jobs.map((job) => job.unattended)).toEqual([false, false, true, false]);
    // Idle: only the overnight print waits, from 01:00 to 08:00.
    expect(best.metrics.totalIdleMinutes).toBe(420);
    expect(result.strategy).toBe('best_fit');
    const { baseline } = result;
    expect(best.metrics.totalIdleMinutes - baseline.metrics.totalIdleMinutes).toBe(-420);
    expect((best.metrics.finishAt ?? 0) - (baseline.metrics.finishAt ?? 0)).toBe(-420);
  });

  it('every other strategy is listed and none is better than the winner for the goal', () => {
    const result = run(queue(), { goal: 'minimal_idle' });

    expect(result.candidates.map((entry) => entry.strategy)).toEqual([
      'naive',
      'queue_order',
      'longest_first',
      'shortest_first',
      'best_fit',
    ]);
    expect(result.candidates.map((entry) => entry.metrics.totalIdleMinutes)).toEqual([
      840, 840, 480, 840, 420,
    ]);
  });

  it('keeps the naive plan when nothing is better (ties go to naive)', () => {
    const result = run([line('a', 1, 2)]);

    expect(result.strategy).toBe('naive');
    expect(result.optimized).toBe(result.baseline);
  });
});

describe('goal keys', () => {
  const metrics = (over: Partial<PlanMetrics>): PlanMetrics => ({
    finishAt: 1000,
    totalIdleMinutes: 100,
    placedUnits: 5,
    unplacedUnits: 0,
    deadlineMet: null,
    ...over,
  });
  const better = (goal: Goal, a: Partial<PlanMetrics>, b: Partial<PlanMetrics>) =>
    compareKeys(goalKey(goal, metrics(a)), goalKey(goal, metrics(b)));

  it('fastest: earlier finish first, then less idle', () => {
    expect(better('fastest', { finishAt: 900, totalIdleMinutes: 999 }, {})).toBeLessThan(0);
    expect(better('fastest', { totalIdleMinutes: 50 }, {})).toBeLessThan(0);
    expect(better('fastest', {}, {})).toBe(0);
  });

  it('minimal_idle: less idle first, then earlier finish', () => {
    expect(better('minimal_idle', { totalIdleMinutes: 50, finishAt: 9999 }, {})).toBeLessThan(0);
    expect(better('minimal_idle', { finishAt: 900 }, {})).toBeLessThan(0);
  });

  it('deadline: a met deadline first, then earlier finish, then less idle', () => {
    expect(
      better('deadline', { deadlineMet: true, finishAt: 9999 }, { deadlineMet: false }),
    ).toBeLessThan(0);
    expect(better('deadline', { finishAt: 900 }, {})).toBeLessThan(0);
    expect(better('deadline', { totalIdleMinutes: 1 }, {})).toBeLessThan(0);
  });

  it('fewer unplaced units always win', () => {
    for (const goal of ['fastest', 'minimal_idle', 'deadline'] as const) {
      expect(better(goal, { unplacedUnits: 0, finishAt: 9999 }, { unplacedUnits: 1 })).toBeLessThan(
        0,
      );
    }
  });

  it('deadlineChange names the four outcomes', () => {
    expect([
      deadlineChange(false, true),
      deadlineChange(true, false),
      deadlineChange(true, true),
      deadlineChange(null, true),
    ]).toEqual(['gained', 'lost', 'same', 'unknown']);
  });
});

describe('edge cases', () => {
  it('reports units that cannot start inside the 14-day horizon, naive and optimised alike', () => {
    // 20 prints of 10 h: one per day (08:00-18:00 ends 18:00, collected next morning).
    const result = run([line('p', 20, 10)]);

    for (const { plan, metrics } of result.candidates) {
      expect(metrics.placedUnits + metrics.unplacedUnits).toBe(20);
      expect(plan.jobs.length).toBeLessThanOrEqual(HORIZON_DAYS + 1);
    }
    expect(result.baseline.metrics.unplacedUnits).toBeGreaterThan(0);
  });

  it('places nothing when the schedule never allows intervention', () => {
    const closed: ScheduleRules = {
      weekly: Array.from({ length: 7 }, () => ({ ranges: [] })),
      exceptions: [],
    };

    const result = run([line('p', 3, 1)], { schedule: closed });

    expect(result.optimized.plan.jobs).toEqual([]);
    expect(result.optimized.metrics).toMatchObject({ placedUnits: 0, unplacedUnits: 3 });
    expect(result.optimized.plan.unplaced).toEqual([{ partId: 'p', units: 3 }]);
  });

  it('with no lines everything is empty and naive wins', () => {
    const result = run([]);

    expect(result.strategy).toBe('naive');
    expect(result.optimized.plan.jobs).toEqual([]);
    expect(result.optimized.plan.finishAt).toBeNull();
  });
});

// ---- Property-style tests with a seeded generator (no dependency) ----

/** mulberry32: a tiny deterministic pseudo-random generator. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomInput(seed: number): OptimizerInput {
  const next = seeded(seed);
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;

  const weekly = Array.from({ length: 7 }, () => {
    const count = int(0, 2);
    const cuts = Array.from({ length: count * 2 }, () => int(0, MINUTES_PER_DAY)).sort(
      (a, b) => a - b,
    );
    const ranges = [];
    for (let index = 0; index + 1 < cuts.length; index += 2) {
      const startMinute = cuts[index] ?? 0;
      const endMinute = cuts[index + 1] ?? 0;
      if (endMinute > startMinute && (ranges.at(-1)?.endMinute ?? -1) < startMinute) {
        ranges.push({ startMinute, endMinute });
      }
    }
    return { ranges };
  });

  const lines = Array.from({ length: int(1, 4) }, (_unused, index): OptimizerLine => ({
    partId: `part${String(index)}`,
    units: int(1, 30),
    seconds: int(60, 40_000),
    size: { x: int(10, 150), y: int(10, 150), z: int(5, 300) },
  }));
  return {
    schedule: { weekly, exceptions: [] },
    startAt: at('2026-03-02T00:00') + int(0, 7 * MINUTES_PER_DAY),
    lines,
    printers: Array.from({ length: int(1, 3) }, (_unused, index) => ({
      printerId: `printer${String(index)}`,
      bed: { x: int(120, 400), y: int(120, 400), z: int(100, 400) },
    })),
    batchSavingBasisPoints: int(0, 5000),
    goal: pick(['fastest', 'minimal_idle', 'deadline'] as const),
    deadline:
      next() < 0.5
        ? null
        : text(at('2026-03-02T00:00') + int(0, 20) * MINUTES_PER_DAY).slice(0, 10),
  };
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe('properties over 300 seeded random queues, windows and printers', () => {
  const cases = Array.from({ length: 300 }, (_unused, index) => randomInput(index + 1));

  it.each(cases.map((input, index) => [index + 1, input] as const))('case %i', (_seed, input) => {
    const timeline = createTimeline(input.schedule);
    const result = optimize(input);
    const total = input.lines.reduce((sum, entry) => sum + entry.units, 0);
    const limit = input.startAt + HORIZON_DAYS * MINUTES_PER_DAY;

    for (const { strategy, plan, metrics } of result.candidates) {
      const label: string = strategy;
      // Every unit is placed or reported, in total and per part.
      expect(metrics.placedUnits + metrics.unplacedUnits, label).toBe(total);
      for (const entry of input.lines) {
        const placed = plan.jobs
          .filter((job) => job.partId === entry.partId)
          .reduce((sum, job) => sum + job.units, 0);
        const lost = plan.unplaced
          .filter((item) => item.partId === entry.partId)
          .reduce((sum, item) => sum + item.units, 0);
        expect(placed + lost, label).toBe(entry.units);
      }

      for (const job of plan.jobs) {
        const printer = input.printers.find((item) => item.printerId === job.printerId);
        const source = input.lines.find((item) => item.partId === job.partId);
        expect(printer, label).toBeDefined();
        if (printer === undefined || source === undefined) continue;
        // Start and handoff are intervention minutes; the handoff is the first one at or after the end.
        expect(timeline.nextIntervention(job.start, job.start), label).toBe(job.start);
        expect(job.handoff, label).toBeGreaterThanOrEqual(job.end);
        expect(timeline.handoffFor(job.end), label).toBe(job.handoff);
        expect(job.start, label).toBeGreaterThanOrEqual(input.startAt);
        expect(job.start, label).toBeLessThanOrEqual(limit);
        expect(job.end, label).toBeGreaterThan(job.start);
        // A plate never holds more pieces than the receiving printer allows (naive: one).
        expect(job.units, label).toBeGreaterThanOrEqual(1);
        expect(job.units, label).toBeLessThanOrEqual(
          strategy === 'naive' ? 1 : plateCapacity(source.size, printer.bed),
        );
        expect(job.plateIndex, label).toBeLessThanOrEqual(job.platesInLine);
        // Exact duration: the single print for naive, the plate formula otherwise.
        expect(job.end - job.start, label).toBe(
          strategy === 'naive'
            ? minutesOf(source.seconds)
            : plateMinutes(source.seconds, job.units, input.batchSavingBasisPoints),
        );
      }

      // Printer and total figures are exactly the sums of their jobs.
      for (const printer of plan.printers) {
        const own = plan.jobs.filter((job) => job.printerId === printer.printerId);
        expect(printer.jobs, label).toBe(own.length);
        expect(printer.busyMinutes, label).toBe(sum(own.map((job) => job.end - job.start)));
        expect(printer.idleMinutes, label).toBe(sum(own.map((job) => job.handoff - job.end)));
      }
      expect(metrics.totalIdleMinutes, label).toBe(
        sum(plan.jobs.map((job) => job.handoff - job.end)),
      );
      expect(sum(plan.printers.map((printer) => printer.busyMinutes)), label).toBe(
        sum(plan.jobs.map((job) => job.end - job.start)),
      );

      // No overlap per printer: the next plate starts at or after the previous collection.
      for (const printer of input.printers) {
        const own = plan.jobs
          .filter((job) => job.printerId === printer.printerId)
          .sort((a, b) => a.start - b.start);
        for (let index = 1; index < own.length; index++) {
          expect(own[index]?.start ?? 0, label).toBeGreaterThanOrEqual(
            own[index - 1]?.handoff ?? 0,
          );
        }
      }
    }

    // Never worse than the naive baseline for the goal, and the naive candidate is the CU10 result.
    expect(
      compareKeys(
        goalKey(input.goal, result.optimized.metrics),
        goalKey(input.goal, result.baseline.metrics),
      ),
    ).toBeLessThanOrEqual(0);
    const naive = simulateNaive({
      schedule: input.schedule,
      startAt: input.startAt,
      lines: input.lines.map((entry) => ({
        partId: entry.partId,
        units: entry.units,
        minutes: Math.max(1, Math.ceil(entry.seconds / 60)),
      })),
      printerIds: input.printers.map((printer) => printer.printerId),
    });
    expect(result.baseline.plan.finishAt).toBe(naive.finishAt);

    // Deterministic: the same input gives the same answer.
    expect(optimize(input)).toEqual(result);
  });
});
