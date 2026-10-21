import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { formatLocalMinutes } from './simulations.domain.js';
import { createSimulationsService } from './simulations.service.js';
import {
  BIG_PART,
  createFakePorts,
  PART_A,
  PART_B,
  PRINTER_1,
  PRINTER_2,
  PROJECT_ID,
  SPOOL_1,
  SPOOL_2,
  type FakePorts,
} from './testing/fakes.js';

const START = '2026-03-02T08:00';

function setup() {
  const ports = createFakePorts();
  return { ports, service: createSimulationsService(ports) };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

const simulate = (ports: FakePorts, startAt = START) =>
  createSimulationsService(ports).simulate({ projectId: PROJECT_ID, startAt });

describe('simulations service', () => {
  it('simulates the queue: remaining units only, deadline and goal echoed', async () => {
    const { ports } = setup();
    ports.queues.set(PROJECT_ID, {
      goal: 'deadline',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [{ partId: PART_A, filamentId: SPOOL_1, quantity: 4, completed: 1 }],
    });
    ports.projects.set(PROJECT_ID, '2026-03-02');

    const result = await simulate(ports);

    expect(result.simulation.jobs).toHaveLength(3);
    expect(result.goal).toBe('deadline');
    expect(result.deadline).toEqual({ date: '2026-03-02', met: true });
    expect(result.warnings).toEqual([]);
    expect(result.partNames.get(PART_A)).toBe('Soporte en L');
  });

  it('reports a missed deadline', async () => {
    const { ports } = setup();
    ports.projects.set(PROJECT_ID, '2026-03-01');

    expect((await simulate(ports)).deadline).toEqual({ date: '2026-03-01', met: false });
  });

  it('skips a deleted part with a warning and still plans the others', async () => {
    const { ports } = setup();
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [
        { partId: 'c'.repeat(24), filamentId: SPOOL_1, quantity: 2, completed: 0 },
        { partId: PART_B, filamentId: SPOOL_1, quantity: 1, completed: 0 },
      ],
    });

    const result = await simulate(ports);

    expect(result.simulation.jobs.map((job) => job.partId)).toEqual([PART_B]);
    expect(result.warnings).toEqual(['part_deleted']);
  });

  it('warns nothing_to_print when every line is done or its part is deleted', async () => {
    const { ports } = setup();
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [{ partId: PART_A, filamentId: SPOOL_1, quantity: 2, completed: 2 }],
    });

    const result = await simulate(ports);

    expect(result.simulation.jobs).toEqual([]);
    expect(result.warnings).toEqual(['nothing_to_print']);
    expect(result.deadline.met).toBeNull();
  });

  it('skips an archived or deleted printer with a warning', async () => {
    const { ports } = setup();
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'multi',
      printerIds: [PRINTER_1, PRINTER_2],
      lines: [{ partId: PART_A, filamentId: SPOOL_1, quantity: 2, completed: 0 }],
    });
    ports.printers.delete(PRINTER_1);

    const result = await simulate(ports);

    expect(new Set(result.simulation.jobs.map((job) => job.printerId))).toEqual(
      new Set([PRINTER_2]),
    );
    expect(result.warnings).toEqual(['printer_unavailable']);
  });

  it('warns when the schedule was never saved (version 0)', async () => {
    const { ports } = setup();
    ports.schedule = { ...ports.schedule, version: 0 };

    expect((await simulate(ports)).warnings).toEqual(['availability_not_configured']);
  });

  it('answers 400 on projectId when the project has no queue', async () => {
    const { ports } = setup();
    ports.queues.clear();

    const error = await failure(simulate(ports));

    expect(error.status).toBe(400);
    expect(error.issues).toEqual([{ path: 'projectId', message: 'The project has no queue.' }]);
  });

  it('answers 400 on projectId when the project was removed', async () => {
    const { ports } = setup();
    ports.projects.clear();

    expect((await failure(simulate(ports))).issues[0]?.path).toBe('projectId');
  });

  it('answers 400 on projectId when no selected printer is available', async () => {
    const { ports } = setup();
    ports.printers.clear();

    const error = await failure(simulate(ports));

    expect(error.status).toBe(400);
    expect(error.issues[0]?.path).toBe('printerIds');
  });

  it('accepts exactly 1000 remaining units and refuses 1001 with too_many_units', async () => {
    const { ports } = setup();
    const queue = { goal: 'fastest', mode: 'single', printerIds: [PRINTER_1] } as const;

    ports.queues.set(PROJECT_ID, {
      ...queue,
      printerIds: [PRINTER_1],
      lines: [{ partId: PART_A, filamentId: SPOOL_1, quantity: 1000, completed: 0 }],
    });
    const ok = await simulate(ports);
    const unplaced = ok.simulation.unplaced.reduce((sum, entry) => sum + entry.units, 0);
    expect(ok.simulation.jobs.length + unplaced).toBe(1000);

    ports.queues.set(PROJECT_ID, {
      ...queue,
      printerIds: [PRINTER_1],
      lines: [
        { partId: PART_A, filamentId: SPOOL_1, quantity: 1000, completed: 0 },
        { partId: PART_B, filamentId: SPOOL_1, quantity: 1, completed: 0 },
      ],
    });
    const error = await failure(simulate(ports));
    expect(error.status).toBe(400);
    expect(error.issues[0]).toMatchObject({ path: 'lines' });
    expect(error.issues[0]?.message).toContain('too_many_units');
  });

  it.each(['queue', 'project', 'parts', 'printers', 'schedule', 'planning', 'filaments'] as const)(
    'turns a failing %s port into a generic 503',
    async (which) => {
      const { ports } = setup();
      ports.failing = which;

      const error = await failure(simulate(ports));

      expect(error.status).toBe(503);
      expect(error.message).not.toContain('boom');
    },
  );
});

describe('simulations service, optimize', () => {
  const optimize = (ports: FakePorts, startAt = START) =>
    createSimulationsService(ports).optimize({ projectId: PROJECT_ID, startAt });

  /** Six 2 h pieces that can share a plate, with a 30 % saving and a same-day deadline. */
  function batchable() {
    const { ports } = setup();
    ports.parts.set(PART_A, {
      name: 'Soporte en L',
      estimatedPrintSeconds: 7200,
      estimatedWeightGrams: 30,
      dimensionsMm: { x: 40, y: 40, z: 20 },
    });
    ports.queues.set(PROJECT_ID, {
      goal: 'deadline',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [{ partId: PART_A, filamentId: SPOOL_1, quantity: 6, completed: 0 }],
    });
    ports.projects.set(PROJECT_ID, '2026-03-02');
    ports.batchSavingBasisPoints = 3000;
    return ports;
  }

  it('batches identical pieces, gains the deadline and warns batching_applied', async () => {
    const result = await optimize(batchable());

    expect(result.strategy).toBe('queue_order');
    expect(result.optimized.plan.jobs.map((job) => job.units)).toEqual([6]);
    expect(result.baseline.plan.jobs).toHaveLength(6);
    expect(result.comparison).toEqual({
      finishDeltaMinutes: -(1440 + 600 - 984),
      idleDeltaMinutes: -840,
      deadlineChanged: 'gained',
    });
    expect(result.deadlineDate).toBe('2026-03-02');
    expect(result.warnings).toEqual(['batching_applied']);
  });

  it('is never worse than the baseline and keeps the naive plan when batching is off', async () => {
    const ports = batchable();
    ports.batchSavingBasisPoints = 0;
    ports.parts.set(PART_A, {
      name: 'Soporte en L',
      estimatedPrintSeconds: 7200,
      estimatedWeightGrams: 30,
      dimensionsMm: { x: 210, y: 100, z: 20 },
    });

    const result = await optimize(ports);

    expect(result.strategy).toBe('naive');
    expect(result.comparison).toMatchObject({ finishDeltaMinutes: 0, idleDeltaMinutes: 0 });
    expect(result.warnings).toEqual([]);
  });

  it('answers nothing_to_print with an empty plan', async () => {
    const { ports } = setup();
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [{ partId: PART_A, filamentId: SPOOL_1, quantity: 1, completed: 1 }],
    });

    const result = await optimize(ports);

    expect(result.optimized.plan.jobs).toEqual([]);
    expect(result.comparison).toEqual({
      finishDeltaMinutes: 0,
      idleDeltaMinutes: 0,
      deadlineChanged: 'unknown',
    });
    expect(result.warnings).toEqual(['nothing_to_print']);
  });

  it('uses the same 400 paths as the simulation', async () => {
    const { ports } = setup();

    expect((await failure(optimize(ports, '2026-02-30T08:00'))).issues[0]?.path).toBe('startAt');
    ports.printers.clear();
    expect((await failure(optimize(ports))).issues[0]?.path).toBe('printerIds');
    ports.projects.clear();
    ports.printers.set(PRINTER_1, {
      name: 'Ender 3',
      buildVolume: { x: 220, y: 220, z: 250 },
    });
    expect((await failure(optimize(ports))).issues[0]?.path).toBe('projectId');
    ports.queues.clear();
    expect((await failure(optimize(ports))).issues[0]?.path).toBe('projectId');
  });

  it('refuses more than 1000 remaining units', async () => {
    const { ports } = setup();
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines: [{ partId: PART_A, filamentId: SPOOL_1, quantity: 1001, completed: 0 }],
    });

    const error = await failure(optimize(ports));

    expect(error.issues[0]).toMatchObject({ path: 'lines' });
    expect(error.issues[0]?.message).toContain('too_many_units');
  });

  it.each(['queue', 'project', 'parts', 'printers', 'schedule', 'planning', 'filaments'] as const)(
    'turns a failing %s port into a generic 503',
    async (which) => {
      const { ports } = setup();
      ports.failing = which;

      const error = await failure(optimize(ports));

      expect(error.status).toBe(503);
      expect(error.message).not.toContain('boom');
    },
  );
});

describe('simulations service, setup times and stock (ADR 0036)', () => {
  const optimize = (ports: FakePorts) =>
    createSimulationsService(ports).optimize({ projectId: PROJECT_ID, startAt: START });

  const queueOf = (
    ports: FakePorts,
    lines: { partId: string; filamentId: string | null; quantity: number; completed: number }[],
  ) =>
    ports.queues.set(PROJECT_ID, {
      goal: 'fastest',
      mode: 'single',
      printerIds: [PRINTER_1],
      lines,
    });

  const twoSpools = (ports: FakePorts) =>
    queueOf(ports, [
      { partId: PART_A, filamentId: SPOOL_1, quantity: 1, completed: 0 },
      { partId: PART_A, filamentId: SPOOL_2, quantity: 1, completed: 0 },
    ]);

  it('shifts the second job by the turnaround, plus the change when the spool differs', async () => {
    const { ports } = setup();
    ports.printerTurnaroundMinutes = 10;
    ports.filamentChangeMinutes = 30;
    twoSpools(ports);

    const different = await simulate(ports);

    expect(different.simulation.jobs.map((job) => formatLocalMinutes(job.start))).toEqual([
      '2026-03-02T08:00',
      '2026-03-02T10:40',
    ]);
    expect(different.simulation.jobs[1]).toMatchObject({ setupMinutes: 40, filamentChanged: true });
    expect(different.simulation).toMatchObject({ totalSetupMinutes: 40, filamentChanges: 1 });

    queueOf(ports, [{ partId: PART_A, filamentId: SPOOL_1, quantity: 2, completed: 0 }]);
    const same = await simulate(ports);

    expect(same.simulation.jobs[1]).toMatchObject({ setupMinutes: 10, filamentChanged: false });
  });

  it('applies the settings to the optimiser too, including the batch saving', async () => {
    const { ports } = setup();
    ports.printerTurnaroundMinutes = 10;
    ports.filamentChangeMinutes = 30;
    twoSpools(ports);

    const result = await optimize(ports);

    expect(result.baseline.plan.jobs[1]).toMatchObject({ setupMinutes: 40, filamentChanged: true });
    expect(result.baseline.metrics).toMatchObject({ totalSetupMinutes: 40, filamentChanges: 1 });
    expect(result.candidates.map((candidate) => candidate.strategy)).toContain('group_by_spool');
  });

  it('adds no setup when both settings are zero', async () => {
    const { ports } = setup();
    twoSpools(ports);

    const result = await simulate(ports);

    expect(result.simulation.totalSetupMinutes).toBe(0);
    expect(result.simulation.jobs[1]?.start).toBe(result.simulation.jobs[0]?.handoff);
  });

  it('warns filament_deleted and treats the spool as unknown, with no change counted', async () => {
    const { ports } = setup();
    ports.printerTurnaroundMinutes = 10;
    ports.filamentChangeMinutes = 30;
    twoSpools(ports);
    ports.spools.delete(SPOOL_2);

    const result = await simulate(ports);

    expect(result.warnings).toEqual(['filament_deleted']);
    expect(result.simulation.jobs[1]).toMatchObject({
      filamentId: null,
      setupMinutes: 10,
      filamentChanged: false,
    });
  });

  it('does not warn for a legacy line without a spool', async () => {
    const { ports } = setup();
    queueOf(ports, [{ partId: PART_A, filamentId: null, quantity: 3, completed: 0 }]);
    ports.spools.clear();

    const result = await simulate(ports);

    expect(result.warnings).toEqual([]);
    expect(result.filamentShortfalls).toEqual([]);
  });

  const sharedSpool = (ports: FakePorts, availableGrams: number) => {
    // Two lines of 2 pieces x 30 g on the same spool: 120 g needed.
    queueOf(ports, [
      { partId: PART_A, filamentId: SPOOL_1, quantity: 2, completed: 0 },
      { partId: PART_B, filamentId: SPOOL_1, quantity: 2, completed: 0 },
    ]);
    ports.spools.set(SPOOL_1, { name: 'Grilon3 PLA Negro', availableGrams });
  };

  it('warns filament_insufficient with the pieces that fit when lines share a short spool', async () => {
    const { ports } = setup();
    sharedSpool(ports, 100);

    const simulated = await simulate(ports);
    const optimized = await optimize(ports);

    expect(simulated.warnings).toEqual(['filament_insufficient']);
    expect(simulated.filamentShortfalls).toEqual([
      {
        filamentId: SPOOL_1,
        name: 'Grilon3 PLA Negro',
        availableGrams: 100,
        neededGrams: 120,
        completablePieces: 3,
        remainingPieces: 1,
      },
    ]);
    expect(optimized.filamentShortfalls).toEqual(simulated.filamentShortfalls);
    expect(simulated.simulation.jobs).toHaveLength(4);
  });

  it('does not warn when the spool has exactly what is needed', async () => {
    const { ports } = setup();
    sharedSpool(ports, 120);

    const result = await simulate(ports);

    expect(result.warnings).toEqual([]);
    expect(result.filamentShortfalls).toEqual([]);
  });

  it('counts only pending pieces and ignores a part without weight', async () => {
    const { ports } = setup();
    sharedSpool(ports, 40);
    ports.queues.get(PROJECT_ID)?.lines.splice(0, 1, {
      partId: PART_A,
      filamentId: SPOOL_1,
      quantity: 2,
      completed: 1,
    });
    ports.parts.set(PART_B, {
      name: 'Florero',
      estimatedPrintSeconds: 3600,
      estimatedWeightGrams: 0,
      dimensionsMm: BIG_PART,
    });

    expect((await simulate(ports)).warnings).toEqual([]);
  });

  it('turns a failing spool lookup into a generic 503', async () => {
    const { ports } = setup();
    ports.failing = 'filaments';

    const error = await failure(simulate(ports));

    expect(error.status).toBe(503);
    expect(error.message).not.toContain('boom');
  });
});
