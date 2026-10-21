// QA matrix of ADR 0036: setup times and spool changes, against the naive planner and the optimiser.
import { describe, expect, it } from 'vitest';
import type { ScheduleRules } from '../availability/index.js';
import {
  createTimeline,
  filamentShortfalls,
  formatLocalMinutes,
  HORIZON_DAYS,
  MINUTES_PER_DAY,
  parseLocalMinutes,
  simulateNaive,
  SIMULATION_WARNING_CODES,
  type SetupConfig,
} from './simulations.domain.js';
import {
  compareKeys,
  goalKey,
  optimize,
  STRATEGIES,
  type Optimization,
  type Plan,
  type PlanMetrics,
} from './simulations.optimizer.js';
import { DAY_SHIFT, ENDER_BED } from './testing/fakes.js';

const at = (value: string): number => {
  const parsed = parseLocalMinutes(value);
  if (parsed === null) throw new Error(`bad test time ${value}`);
  return parsed;
};
const text = (minutes: number): string => formatLocalMinutes(minutes);
const MONDAY_8 = '2026-03-02T08:00';
// 210 x 100 never shares a plate on the Ender bed, so one plate is one piece in every strategy.
const BIG = { x: 210, y: 100, z: 50 };

interface Spec {
  readonly partId: string;
  readonly units: number;
  readonly minutes: number;
  readonly filamentId: string | null;
}
const spec = (partId: string, filamentId: string | null, minutes = 60, units = 1): Spec => ({
  partId,
  units,
  minutes,
  filamentId,
});

interface Case {
  readonly lines: readonly Spec[];
  readonly printers?: readonly string[];
  readonly setup: SetupConfig;
  readonly schedule?: ScheduleRules;
}
const cfg = (turnaroundMinutes: number, filamentChangeMinutes: number): SetupConfig => ({
  turnaroundMinutes,
  filamentChangeMinutes,
});

const runNaive = (c: Case) =>
  simulateNaive({
    schedule: c.schedule ?? DAY_SHIFT,
    startAt: at(MONDAY_8),
    lines: c.lines,
    printerIds: c.printers ?? ['A'],
    setup: c.setup,
  });

const runOptimizer = (
  c: Case,
  goal: 'fastest' | 'minimal_idle' | 'deadline' = 'fastest',
): Optimization =>
  optimize({
    schedule: c.schedule ?? DAY_SHIFT,
    startAt: at(MONDAY_8),
    lines: c.lines.map((line) => ({
      partId: line.partId,
      units: line.units,
      seconds: line.minutes * 60,
      size: BIG,
      filamentId: line.filamentId,
    })),
    printers: (c.printers ?? ['A']).map((printerId) => ({ printerId, bed: ENDER_BED })),
    batchSavingBasisPoints: 0,
    goal,
    deadline: null,
    setup: c.setup,
  });

/** What the naive Simulation and the optimiser Plan have in common. */
interface View {
  readonly jobs: readonly Pick<
    Plan['jobs'][number],
    | 'partId'
    | 'printerId'
    | 'start'
    | 'end'
    | 'handoff'
    | 'unattended'
    | 'filamentId'
    | 'setupMinutes'
    | 'filamentChanged'
  >[];
  readonly printers: Plan['printers'];
  readonly unplaced: Plan['unplaced'];
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Every property that must hold for any plan, whoever produced it (P1 to P4, P8). */
function expectInvariants(plan: View, c: Case, label: string): void {
  const timeline = createTimeline(c.schedule ?? DAY_SHIFT);
  for (const printer of c.printers ?? ['A']) {
    const own = plan.jobs
      .filter((job) => job.printerId === printer)
      .sort((a, b) => a.start - b.start);
    own.forEach((job, index) => {
      const previous = own[index - 1];
      if (previous === undefined) {
        // P1: the first job of a printer has no setup.
        expect(job.setupMinutes, label).toBe(0);
        expect(job.filamentChanged, label).toBe(false);
        return;
      }
      const change =
        previous.filamentId !== null &&
        job.filamentId !== null &&
        previous.filamentId !== job.filamentId;
      // P2: the print starts one setup after the previous handoff.
      expect(job.filamentChanged, label).toBe(change);
      expect(job.setupMinutes, label).toBe(
        c.setup.turnaroundMinutes + (change ? c.setup.filamentChangeMinutes : 0),
      );
      expect(job.start, label).toBe(previous.handoff + job.setupMinutes);
      // P3: from one handoff to the next is setup + busy + idle.
      expect(job.handoff - previous.handoff, label).toBe(
        job.setupMinutes + (job.end - job.start) + (job.handoff - job.end),
      );
      // P4: no overlap, and the previous handoff is a minute somebody can intervene.
      expect(job.start, label).toBeGreaterThanOrEqual(previous.handoff);
      expect(timeline.nextIntervention(previous.handoff, previous.handoff), label).toBe(
        previous.handoff,
      );
    });
  }
  // P8: printer figures are the sums of their jobs.
  for (const printer of plan.printers) {
    const own = plan.jobs.filter((job) => job.printerId === printer.printerId);
    expect(printer.jobs, label).toBe(own.length);
    expect(printer.busyMinutes, label).toBe(sum(own.map((job) => job.end - job.start)));
    expect(printer.idleMinutes, label).toBe(sum(own.map((job) => job.handoff - job.end)));
    expect(printer.setupMinutes, label).toBe(sum(own.map((job) => job.setupMinutes)));
    expect(printer.filamentChanges, label).toBe(own.filter((job) => job.filamentChanged).length);
  }
}

/** Every day: intervention windows 08:00-12:00 and 14:00-18:00. */
const splitShift = (): ScheduleRules => ({
  weekly: DAY_SHIFT.weekly.map(() => ({
    ranges: [
      { startMinute: 480, endMinute: 720 },
      { startMinute: 840, endMinute: 1080 },
    ],
  })),
  exceptions: [],
  absences: [],
});

const CASES: readonly (readonly [string, Case])[] = [
  ['a single job', { lines: [spec('a', 'A')], setup: cfg(10, 30) }],
  ['the same spool three times', { lines: [spec('a', 'A', 60, 3)], setup: cfg(10, 30) }],
  [
    'alternating spools',
    { lines: ['A', 'B', 'A', 'B'].map((f, i) => spec(`p${String(i)}`, f)), setup: cfg(10, 30) },
  ],
  ['unknown spool before', { lines: [spec('a', null), spec('b', 'B')], setup: cfg(10, 30) }],
  ['unknown spool after', { lines: [spec('a', 'A'), spec('b', null)], setup: cfg(10, 30) }],
  ['unknown spool on both', { lines: [spec('a', null), spec('b', null)], setup: cfg(10, 30) }],
  ['turnaround 0, change 30', { lines: [spec('a', 'A'), spec('b', 'B')], setup: cfg(0, 30) }],
  ['turnaround 10, change 0', { lines: [spec('a', 'A'), spec('b', 'B')], setup: cfg(10, 0) }],
  [
    'two printers',
    {
      lines: [spec('a', 'A', 90, 2), spec('b', 'B', 45, 3), spec('c', null, 120)],
      printers: ['P1', 'P2'],
      setup: cfg(10, 30),
    },
  ],
  [
    'maximum 240 / 240 over the horizon',
    {
      lines: [spec('a', 'A', 600, 8), spec('b', 'B', 600, 8)],
      printers: ['P1', 'P2'],
      setup: cfg(240, 240),
    },
  ],
  ['0 / 0', { lines: [spec('a', 'A', 60, 2), spec('b', 'B')], setup: cfg(0, 0) }],
];

describe('shared invariants, naive and every optimiser strategy', () => {
  it.each(CASES)('%s', (_label, c) => {
    const naive = runNaive(c);
    expectInvariants(naive, c, 'naive');
    expect(naive.totalSetupMinutes).toBe(sum(naive.jobs.map((job) => job.setupMinutes)));
    expect(naive.filamentChanges).toBe(naive.jobs.filter((job) => job.filamentChanged).length);

    const result = runOptimizer(c);
    for (const { strategy, plan, metrics } of result.candidates) {
      expectInvariants(plan, c, strategy);
      expect(metrics.totalSetupMinutes, strategy).toBe(sum(plan.jobs.map((j) => j.setupMinutes)));
      expect(metrics.filamentChanges, strategy).toBe(
        plan.jobs.filter((job) => job.filamentChanged).length,
      );
    }
    // The optimiser's baseline is the naive planner, setup included.
    expect(result.baseline.plan.finishAt).toBe(naive.finishAt);
    expect(result.baseline.metrics.totalSetupMinutes).toBe(naive.totalSetupMinutes);
  });
});

// On these inputs the optimiser's queue_order prints in queue order, like the naive planner.
const ENGINES = ['naive', 'queue_order'] as const;
const planBy = (engine: (typeof ENGINES)[number], c: Case): View => {
  if (engine === 'naive') return runNaive(c);
  const found = runOptimizer(c).candidates.find((entry) => entry.strategy === 'queue_order');
  if (found === undefined) throw new Error('queue_order is always a candidate');
  return found.plan;
};
const rowsOf = (plan: View) =>
  plan.jobs.map((job) => [
    job.partId,
    text(job.start),
    text(job.end),
    text(job.handoff),
    job.setupMinutes,
    job.filamentChanged,
    job.unattended,
  ]);

describe.each(ENGINES)('exact schedules, %s', (engine) => {
  const plan = (c: Case): View => planBy(engine, c);

  it('starts the second print after turnaround plus a spool change', () => {
    const result = plan({ lines: [spec('a', 'A'), spec('b', 'B')], setup: cfg(10, 30) });

    expect(rowsOf(result)).toEqual([
      ['a', '2026-03-02T08:00', '2026-03-02T09:00', '2026-03-02T09:00', 0, false, false],
      ['b', '2026-03-02T09:40', '2026-03-02T10:40', '2026-03-02T10:40', 40, true, false],
    ]);
    expect(result.printers[0]).toMatchObject({ setupMinutes: 40, filamentChanges: 1 });
  });

  it('adds only the turnaround for the same spool', () => {
    const result = plan({ lines: [spec('a', 'A', 60, 3)], setup: cfg(10, 30) });

    expect(result.jobs.map((job) => [text(job.start), job.setupMinutes])).toEqual([
      ['2026-03-02T08:00', 0],
      ['2026-03-02T09:10', 10],
      ['2026-03-02T10:20', 10],
    ]);
  });

  it.each([
    ['previous', null, 'B'],
    ['next', 'A', null],
    ['both', null, null],
  ])('an unknown spool on the %s print is no change but keeps the turnaround', (_l, one, two) => {
    const result = plan({ lines: [spec('a', one), spec('b', two)], setup: cfg(10, 30) });

    expect(result.jobs.map((job) => [job.setupMinutes, job.filamentChanged])).toEqual([
      [0, false],
      [10, false],
    ]);
  });

  it('supports turnaround 0 with a change, and a turnaround with no change time', () => {
    const lines = [spec('a', 'A'), spec('b', 'B')];

    expect(plan({ lines, setup: cfg(0, 30) }).jobs[1]).toMatchObject({
      setupMinutes: 30,
      filamentChanged: true,
    });
    expect(plan({ lines, setup: cfg(10, 0) }).jobs[1]).toMatchObject({
      setupMinutes: 10,
      filamentChanged: true,
    });
  });

  it('keeps a single job free of setup', () => {
    const result = plan({ lines: [spec('a', 'A')], setup: cfg(240, 240) });

    expect(result.jobs[0]).toMatchObject({ setupMinutes: 0, filamentChanged: false });
    expect(result.printers[0]).toMatchObject({ setupMinutes: 0, filamentChanges: 0 });
  });

  it('keeps the last spool of each printer independent', () => {
    const result = plan({
      lines: [spec('a', 'A'), spec('b', 'B'), spec('c', 'A'), spec('d', 'B')],
      printers: ['P1', 'P2'],
      setup: cfg(10, 30),
    });

    expect(result.jobs.map((job) => [job.partId, job.printerId, job.filamentChanged])).toEqual([
      ['a', 'P1', false],
      ['b', 'P2', false],
      ['c', 'P1', false],
      ['d', 'P2', false],
    ]);
    expect(result.jobs.map((job) => job.setupMinutes)).toEqual([0, 0, 10, 10]);
  });

  it('with 0 / 0 gives the schedule of ADR 0026 (three 2 h prints, no setup)', () => {
    const result = plan({ lines: [spec('p', 'A', 120, 3)], setup: cfg(0, 0) });

    expect(result.jobs.map((job) => [text(job.start), text(job.end), text(job.handoff)])).toEqual([
      ['2026-03-02T08:00', '2026-03-02T10:00', '2026-03-02T10:00'],
      ['2026-03-02T10:00', '2026-03-02T12:00', '2026-03-02T12:00'],
      ['2026-03-02T12:00', '2026-03-02T14:00', '2026-03-02T14:00'],
    ]);
    expect(result.printers[0]).toMatchObject({ busyMinutes: 360, idleMinutes: 0 });
  });

  describe('unattended when the setup crosses the end of the window (08:00-18:00)', () => {
    // The first job runs 08:00-17:00 and is collected at 17:00; the second setup is 10 minutes.
    const second = (minutes: number): View =>
      plan({ lines: [spec('a', 'A', 540), spec('b', 'A', minutes)], setup: cfg(10, 30) });

    it('ending exactly at 18:00 is attended', () => {
      expect(text(second(50).jobs[1]?.end ?? 0)).toBe('2026-03-02T18:00');
      expect(second(50).jobs[1]?.unattended).toBe(false);
    });

    it('ending one minute later is unattended', () => {
      expect(second(51).jobs[1]?.unattended).toBe(true);
    });

    it('a setup that starts when the window opens is attended', () => {
      // 600 min fills 08:00-18:00; collected next day at 08:00; setup 08:00-08:10, print 1 h.
      const result = plan({
        lines: [spec('a', 'A', 600), spec('b', 'A', 60)],
        setup: cfg(10, 30),
      });

      expect(text(result.jobs[1]?.start ?? 0)).toBe('2026-03-03T08:10');
      expect(result.jobs[1]?.unattended).toBe(false);
    });

    it('a setup that spans the gap between two windows is unattended although the print is attended', () => {
      // Collected at 11:50; setup 120 + 120 runs 11:50-15:50 across the 12:00-14:00 gap; the print
      // (15:50-16:50) lies wholly inside a window, so measuring from the print start would say false.
      const result = plan({
        lines: [spec('a', 'A', 230), spec('b', 'B', 60)],
        setup: cfg(120, 120),
        schedule: splitShift(),
      });

      expect(result.jobs[1]).toMatchObject({ filamentChanged: true, setupMinutes: 240 });
      expect([text(result.jobs[0]?.handoff ?? 0), text(result.jobs[1]?.start ?? 0)]).toEqual([
        '2026-03-02T11:50',
        '2026-03-02T15:50',
      ]);
      expect(text(result.jobs[1]?.end ?? 0)).toBe('2026-03-02T16:50');
      expect(result.jobs[1]?.unattended).toBe(true);
    });

    it('a setup that runs far past the end of the window is unattended', () => {
      const result = plan({
        lines: [spec('a', 'A', 540), spec('b', 'B', 60)],
        setup: cfg(240, 240),
      });

      expect(result.jobs[1]?.unattended).toBe(true);
    });
  });

  it('reports the late jobs of the 14-day horizon as unplaced, with setup 240 / 240', () => {
    const c: Case = {
      lines: [spec('a', 'A', 600, 10), spec('b', 'B', 600, 10)],
      setup: cfg(240, 240),
    };
    const result = plan(c);
    const limit = at(MONDAY_8) + HORIZON_DAYS * MINUTES_PER_DAY;

    expect(result.jobs.length + sum(result.unplaced.map((entry) => entry.units))).toBe(20);
    expect(result.unplaced.length).toBeGreaterThan(0);
    // The setup starts inside the horizon; only the print itself may start after it.
    for (const job of result.jobs) expect(job.start - job.setupMinutes).toBeLessThanOrEqual(limit);
    expectInvariants(result, c, engine);
  });

  it('leaves the printer untouched when a job cannot be collected', () => {
    // One short window exists; the second print never ends inside a window, so it is unplaced.
    const schedule: ScheduleRules = {
      weekly: DAY_SHIFT.weekly.map(() => ({ ranges: [] })),
      exceptions: [{ date: '2026-03-02', ranges: [{ startMinute: 480, endMinute: 540 }] }],
      absences: [],
    };
    const result = plan({
      lines: [spec('a', 'A', 20), spec('b', 'B', 60 * 24 * 90)],
      setup: cfg(10, 30),
      schedule,
    });

    expect(result.jobs.map((job) => job.partId)).toEqual(['a']);
    expect(result.unplaced).toEqual([{ partId: 'b', units: 1 }]);
    expect(result.printers[0]).toMatchObject({
      jobs: 1,
      busyMinutes: 20,
      setupMinutes: 0,
      filamentChanges: 0,
    });
  });
});

it('simulateNaive defaults to no setup when the configuration is omitted', () => {
  const lines = [spec('a', 'A'), spec('b', 'B')];
  const withDefault = simulateNaive({
    schedule: DAY_SHIFT,
    startAt: at(MONDAY_8),
    lines,
    printerIds: ['A'],
  });

  expect(withDefault.totalSetupMinutes).toBe(0);
  expect(withDefault).toEqual(runNaive({ lines, setup: cfg(0, 0) }));
});

describe('optimiser, spools and setup', () => {
  const key = (goal: 'fastest' | 'minimal_idle' | 'deadline', over: Partial<PlanMetrics>) =>
    goalKey(goal, {
      finishAt: 1000,
      totalIdleMinutes: 100,
      totalSetupMinutes: 0,
      filamentChanges: 0,
      placedUnits: 5,
      unplacedUnits: 0,
      deadlineMet: null,
      ...over,
    });

  it('lists group_by_spool right after best_fit, with naive first', () => {
    expect(STRATEGIES[0]).toBe('naive');
    expect(STRATEGIES.indexOf('group_by_spool')).toBe(STRATEGIES.indexOf('best_fit') + 1);
  });

  it.each(['fastest', 'minimal_idle', 'deadline'] as const)(
    '%s ends its key with the number of spool changes, after every other criterion',
    (goal) => {
      const base = key(goal, {});

      expect(base.at(-1)).toBe(0);
      expect(compareKeys(key(goal, { filamentChanges: -1 }), base)).toBeLessThan(0);
      expect(compareKeys(key(goal, { finishAt: 1001, filamentChanges: -5 }), base)).toBeGreaterThan(
        0,
      );
    },
  );

  it('fewer spool changes but a later finish does not win under fastest', () => {
    const later = key('fastest', { finishAt: 1001, filamentChanges: 0 });
    const earlier = key('fastest', { finishAt: 1000, filamentChanges: 9 });

    expect(compareKeys(later, earlier)).toBeGreaterThan(0);
  });

  it('keeps the naive plan on a tie', () => {
    const result = runOptimizer({ lines: [spec('a', 'A', 120)], setup: cfg(10, 30) });

    expect(result.strategy).toBe('naive');
    expect(result.optimized).toBe(result.baseline);
  });

  it('never puts different spools on one plate', () => {
    const small = { x: 40, y: 40, z: 20 };
    const result = optimize({
      schedule: DAY_SHIFT,
      startAt: at(MONDAY_8),
      lines: [
        { partId: 'p', units: 3, seconds: 600, size: small, filamentId: 'A' },
        { partId: 'p', units: 3, seconds: 600, size: small, filamentId: 'B' },
      ],
      printers: [{ printerId: 'A', bed: ENDER_BED }],
      batchSavingBasisPoints: 0,
      goal: 'fastest',
      deadline: null,
      setup: cfg(10, 30),
    });

    const queue = result.candidates.find((entry) => entry.strategy === 'queue_order');
    expect(queue?.plan.jobs.map((job) => [job.filamentId, job.units])).toEqual([
      ['A', 3],
      ['B', 3],
    ]);
    for (const { plan } of result.candidates) {
      for (const spool of ['A', 'B']) {
        const pieces = plan.jobs.filter((job) => job.filamentId === spool).map((job) => job.units);
        expect(sum(pieces)).toBe(3);
      }
    }
  });

  describe('worked example: one printer, goal fastest, spools A B A B, 10 / 30', () => {
    const lines = ['A', 'B', 'A', 'B'].map((f, i) => spec(`p${String(i + 1)}`, f));
    const result = runOptimizer({ lines, setup: cfg(10, 30) });
    const timesOf = (plan: Plan) =>
      plan.jobs.map((job) => [job.partId, text(job.start), text(job.handoff)]);

    it('naive changes spool three times and ends at 14:00', () => {
      expect(timesOf(result.baseline.plan)).toEqual([
        ['p1', '2026-03-02T08:00', '2026-03-02T09:00'],
        ['p2', '2026-03-02T09:40', '2026-03-02T10:40'],
        ['p3', '2026-03-02T11:20', '2026-03-02T12:20'],
        ['p4', '2026-03-02T13:00', '2026-03-02T14:00'],
      ]);
      expect(result.baseline.metrics).toMatchObject({ filamentChanges: 3, totalSetupMinutes: 120 });
    });

    it('group_by_spool prints A A B B: one change, 60 setup minutes, 13:00', () => {
      const grouped = result.candidates.find((entry) => entry.strategy === 'group_by_spool');

      expect(grouped && timesOf(grouped.plan)).toEqual([
        ['p1', '2026-03-02T08:00', '2026-03-02T09:00'],
        ['p3', '2026-03-02T09:10', '2026-03-02T10:10'],
        ['p2', '2026-03-02T10:50', '2026-03-02T11:50'],
        ['p4', '2026-03-02T12:00', '2026-03-02T13:00'],
      ]);
      expect(grouped?.metrics).toMatchObject({ filamentChanges: 1, totalSetupMinutes: 60 });
    });

    it('the answer has fewer changes and does not finish later than naive', () => {
      expect(result.optimized.metrics.filamentChanges).toBe(1);
      expect(result.optimized.metrics.finishAt).toBe(at('2026-03-02T13:00'));
      expect(result.optimized.metrics.finishAt ?? 0).toBeLessThanOrEqual(
        result.baseline.metrics.finishAt ?? 0,
      );
    });
  });

  it('an unknown spool does not force changes: naive counts none and only turnarounds', () => {
    const lines = ['A', null, 'B', null].map((f, i) => spec(`p${String(i)}`, f));
    const result = runOptimizer({ lines, setup: cfg(10, 30) });

    expect(result.baseline.metrics.filamentChanges).toBe(0);
    expect(result.baseline.metrics.totalSetupMinutes).toBe(30);
  });

  /** mulberry32, as in the optimiser spec. */
  const seeded = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  };

  it.each(Array.from({ length: 60 }, (_unused, index) => index + 1))(
    'is never worse than the baseline and keeps every invariant (fixture %i)',
    (seed) => {
      const next = seeded(seed);
      const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
      const spools = ['A', 'B', 'C', null] as const;
      const c: Case = {
        lines: Array.from({ length: int(1, 5) }, (_unused, index) =>
          spec(
            `p${String(index)}`,
            spools[int(0, spools.length - 1)] ?? null,
            int(20, 900),
            int(1, 4),
          ),
        ),
        printers: Array.from({ length: int(1, 3) }, (_unused, index) => `P${String(index)}`),
        setup: cfg(int(0, 240), int(0, 240)),
      };
      for (const goal of ['fastest', 'minimal_idle', 'deadline'] as const) {
        const result = runOptimizer(c, goal);
        const optimized = goalKey(goal, result.optimized.metrics);

        expect(compareKeys(optimized, goalKey(goal, result.baseline.metrics))).toBeLessThanOrEqual(
          0,
        );
        for (const { strategy, plan } of result.candidates) expectInvariants(plan, c, strategy);
      }
    },
  );
});

describe('filamentShortfalls', () => {
  const stock = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('adds the lines that share a spool: 100 g and two lines of 60 g', () => {
    const result = filamentShortfalls(
      [
        { filamentId: 'A', pendingUnits: 1, unitWeightGrams: 60 },
        { filamentId: 'A', pendingUnits: 1, unitWeightGrams: 60 },
      ],
      stock({ A: 100 }),
    );

    expect(result).toEqual([
      {
        filamentId: 'A',
        availableGrams: 100,
        neededGrams: 120,
        completablePieces: 1,
        remainingPieces: 1,
      },
    ]);
  });

  it('has no entry when the need equals the stock, and one when it is a gram more', () => {
    const lines = [{ filamentId: 'A', pendingUnits: 4, unitWeightGrams: 25 }];

    expect(filamentShortfalls(lines, stock({ A: 100 }))).toEqual([]);
    expect(filamentShortfalls(lines, stock({ A: 99 }))).toEqual([
      {
        filamentId: 'A',
        availableGrams: 99,
        neededGrams: 100,
        completablePieces: 3,
        remainingPieces: 1,
      },
    ]);
  });

  it('reports each short spool and skips a sufficient one', () => {
    const result = filamentShortfalls(
      [
        { filamentId: 'A', pendingUnits: 10, unitWeightGrams: 10 },
        { filamentId: 'B', pendingUnits: 1, unitWeightGrams: 10 },
        { filamentId: 'C', pendingUnits: 2, unitWeightGrams: 50 },
      ],
      stock({ A: 40, B: 500, C: 0 }),
    );

    expect(result.map((entry) => [entry.filamentId, entry.completablePieces])).toEqual([
      ['A', 4],
      ['C', 0],
    ]);
  });

  it('ignores lines without a spool, with an unknown spool, or without a weight', () => {
    const result = filamentShortfalls(
      [
        { filamentId: null, pendingUnits: 9, unitWeightGrams: 999 },
        { filamentId: 'gone', pendingUnits: 9, unitWeightGrams: 999 },
        { filamentId: 'A', pendingUnits: 9, unitWeightGrams: 0 },
        { filamentId: 'A', pendingUnits: 9 },
        { filamentId: 'A', pendingUnits: 0, unitWeightGrams: 50 },
      ],
      stock({ A: 1 }),
    );

    expect(result).toEqual([]);
  });

  it('one spool, light 10 g x 3 and heavy 50 g x 2, stock 120 g: completable = floor(120 x 5 / 130) = 4, remaining = 5 - 4', () => {
    const result = filamentShortfalls(
      [
        { filamentId: 'A', pendingUnits: 3, unitWeightGrams: 10 },
        { filamentId: 'A', pendingUnits: 2, unitWeightGrams: 50 },
      ],
      stock({ A: 120 }),
    );

    expect(result).toEqual([
      {
        filamentId: 'A',
        availableGrams: 120,
        neededGrams: 130,
        completablePieces: 4,
        remainingPieces: 1,
      },
    ]);
  });

  it('registers the two new warning codes', () => {
    expect(SIMULATION_WARNING_CODES).toContain('filament_insufficient');
    expect(SIMULATION_WARNING_CODES).toContain('filament_deleted');
  });
});
