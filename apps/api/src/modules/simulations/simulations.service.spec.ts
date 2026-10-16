import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { createSimulationsService } from './simulations.service.js';
import {
  createFakePorts,
  PART_A,
  PART_B,
  PRINTER_1,
  PRINTER_2,
  PROJECT_ID,
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
      lines: [{ partId: PART_A, quantity: 4, completed: 1 }],
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
        { partId: 'c'.repeat(24), quantity: 2, completed: 0 },
        { partId: PART_B, quantity: 1, completed: 0 },
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
      lines: [{ partId: PART_A, quantity: 2, completed: 2 }],
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
      lines: [{ partId: PART_A, quantity: 2, completed: 0 }],
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
      lines: [{ partId: PART_A, quantity: 1000, completed: 0 }],
    });
    const ok = await simulate(ports);
    const unplaced = ok.simulation.unplaced.reduce((sum, entry) => sum + entry.units, 0);
    expect(ok.simulation.jobs.length + unplaced).toBe(1000);

    ports.queues.set(PROJECT_ID, {
      ...queue,
      printerIds: [PRINTER_1],
      lines: [
        { partId: PART_A, quantity: 1000, completed: 0 },
        { partId: PART_B, quantity: 1, completed: 0 },
      ],
    });
    const error = await failure(simulate(ports));
    expect(error.status).toBe(400);
    expect(error.issues[0]).toMatchObject({ path: 'lines' });
    expect(error.issues[0]?.message).toContain('too_many_units');
  });

  it.each(['queue', 'project', 'parts', 'printers', 'schedule'] as const)(
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
