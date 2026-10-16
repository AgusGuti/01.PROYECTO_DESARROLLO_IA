import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { createQueuesService } from './queues.service.js';
import {
  createFakePorts,
  createFakeQueueRepository,
  createTestClock,
  line,
  PART_A,
  PART_B,
  PART_C,
  PRINTER_1,
  PRINTER_2,
  PROJECT_ID,
  validFields,
} from './testing/fakes.js';

function setup() {
  const repository = createFakeQueueRepository();
  const ports = createFakePorts();
  const service = createQueuesService({ repository, clock: createTestClock(), ...ports });
  return { service, repository, ports };
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

const input = {
  projectId: PROJECT_ID,
  goal: 'fastest',
  mode: 'single',
  printerIds: [PRINTER_1],
} as const;

describe('create', () => {
  it('copies the project lines with completed 0 when lines are omitted', async () => {
    const { service, repository } = setup();

    const { queue, totals } = await service.create(input);

    expect(queue.lines).toEqual([line(PART_A, 4), line(PART_B, 2)]);
    expect(queue.version).toBe(1);
    // 4 x 3600 + 2 x 600
    expect(totals).toEqual({
      totalUnits: 6,
      completedUnits: 0,
      pendingUnits: 6,
      pendingSeconds: 15_600,
    });
    expect(repository.stored.get(PROJECT_ID)).toBeDefined();
  });

  it('keeps the lines it is given and ignores the project items', async () => {
    const { service } = setup();

    const { queue } = await service.create({ ...input, lines: [line(PART_B, 3, 1)] });

    expect(queue.lines).toEqual([line(PART_B, 3, 1)]);
  });

  it('reports a missing project, missing parts and bad printers all at once', async () => {
    const { service, repository, ports } = setup();
    ports.printers.delete(PRINTER_2);

    const error = await failureOf(
      service.create({
        ...input,
        projectId: '9'.repeat(24),
        mode: 'multi',
        printerIds: [PRINTER_1, PRINTER_2],
        lines: [line(PART_A, 1), line(PART_C, 1)],
      }),
    );

    expect(error.code).toBe('validation_failed');
    expect(error.issues).toEqual([
      { path: 'projectId', message: 'The project does not exist.' },
      { path: 'lines.1.partId', message: 'The part does not exist.' },
      { path: 'printerIds.1', message: 'The printer does not exist or is archived.' },
    ]);
    expect(repository.calls).toEqual([]);
  });

  it('rejects an archived printer like a missing one', async () => {
    const { service, ports } = setup();
    ports.printers.clear();

    const error = await failureOf(service.create(input));

    expect(error.issues.map((issue) => issue.path)).toEqual(['printerIds.0']);
  });

  it('rejects a wrong printer count without calling any port', async () => {
    const { service, ports } = setup();

    const error = await failureOf(service.create({ ...input, mode: 'multi' }));

    expect(error.issues.map((issue) => issue.path)).toEqual(['printerIds']);
    expect(ports.partCalls).toEqual([]);
  });

  it('answers a conflict on projectId when the project already has a queue', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);

    const error = await failureOf(service.create(input));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'projectId' }] });
  });

  it.each(['project', 'parts', 'printers'] as const)(
    'answers a generic 503 and writes nothing when the %s port fails',
    async (failing) => {
      const { service, repository, ports } = setup();
      ports.failing = failing;

      const error = await failureOf(service.create(input));

      expect(error.code).toBe('service_unavailable');
      expect(error.message).not.toContain('boom');
      expect(repository.stored.size).toBe(0);
    },
  );
});

describe('get', () => {
  it('enriches the lines and flags a deleted part', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID, { ...validFields, lines: [line(PART_A, 4, 1), line(PART_C, 2)] });

    const { parts, totals } = await service.get(PROJECT_ID);

    expect(parts.get(PART_A)).toEqual({ name: 'Soporte en L', estimatedPrintSeconds: 3600 });
    expect(parts.has(PART_C)).toBe(false);
    expect(totals.pendingSeconds).toBe(10_800);
  });

  it('asks the parts port once for all lines', async () => {
    const { service, repository, ports } = setup();
    repository.seed(PROJECT_ID, { ...validFields, lines: [line(PART_A, 1), line(PART_B, 1)] });

    await service.get(PROJECT_ID);

    expect(ports.partCalls).toEqual([[PART_A, PART_B]]);
  });

  it('answers 404 when the project has no queue', async () => {
    expect((await failureOf(setup().service.get(PROJECT_ID))).code).toBe('not_found');
  });

  it('answers 503 when the parts port fails', async () => {
    const { service, repository, ports } = setup();
    repository.seed(PROJECT_ID);
    ports.failing = 'parts';

    expect((await failureOf(service.get(PROJECT_ID))).code).toBe('service_unavailable');
  });

  it('answers a generic internal error when the seconds are not safe integers', async () => {
    const { service, repository, ports } = setup();
    repository.seed(PROJECT_ID, { ...validFields, lines: [line(PART_A, 1000)] });
    ports.parts.set(PART_A, { name: 'x', estimatedPrintSeconds: 10_000_000_000_000 });

    expect((await failureOf(service.get(PROJECT_ID))).code).toBe('internal');
  });
});

describe('update', () => {
  it('changes the goal and bumps the version', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);

    const { queue } = await service.update(PROJECT_ID, { version: 1, goal: 'deadline' });

    expect(queue).toMatchObject({ goal: 'deadline', version: 2, printerIds: [PRINTER_1] });
  });

  it('checks the merged result: multi mode with the stored single printer is a 400', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);

    const error = await failureOf(service.update(PROJECT_ID, { version: 1, mode: 'multi' }));

    expect(error).toMatchObject({ code: 'validation_failed', issues: [{ path: 'printerIds' }] });
    expect(repository.calls).not.toContain('update');
  });

  it('does not re-check a stored printer that was archived meanwhile', async () => {
    const { service, repository, ports } = setup();
    repository.seed(PROJECT_ID);
    ports.printers.clear();

    const { queue } = await service.update(PROJECT_ID, { version: 1, goal: 'deadline' });

    expect(queue.version).toBe(2);
  });

  it('rejects a newly selected archived printer', async () => {
    const { service, repository, ports } = setup();
    repository.seed(PROJECT_ID);
    ports.printers.delete(PRINTER_2);

    const error = await failureOf(
      service.update(PROJECT_ID, { version: 1, mode: 'multi', printerIds: [PRINTER_1, PRINTER_2] }),
    );

    expect(error.issues).toEqual([
      { path: 'printerIds.1', message: 'The printer does not exist or is archived.' },
    ]);
  });

  it('answers 404 before 409 and 409 before a domain 400', async () => {
    const { service, repository } = setup();

    expect((await failureOf(service.update(PROJECT_ID, { version: 9, mode: 'multi' }))).code).toBe(
      'not_found',
    );
    repository.seed(PROJECT_ID);
    expect((await failureOf(service.update(PROJECT_ID, { version: 9, mode: 'multi' }))).code).toBe(
      'conflict',
    );
  });

  it('answers 409 when the guarded write matches nothing because of a race', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);
    // Another writer bumps the version between our read and our write.
    const realUpdate = repository.update.bind(repository);
    repository.update = (id, version, patch, now) => {
      repository.seed(PROJECT_ID, validFields, 2);
      return realUpdate(id, version, patch, now);
    };

    const error = await failureOf(service.update(PROJECT_ID, { version: 1, goal: 'deadline' }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
  });

  it('answers 404 when the queue is deleted between the read and the write', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);
    const realUpdate = repository.update.bind(repository);
    repository.update = (id, version, patch, now) => {
      repository.stored.delete(id);
      return realUpdate(id, version, patch, now);
    };

    expect(
      (await failureOf(service.update(PROJECT_ID, { version: 1, goal: 'deadline' }))).code,
    ).toBe('not_found');
  });

  it('lets a line whose part was deleted change completed and quantity without a lookup', async () => {
    const { service, repository, ports } = setup();
    repository.seed(PROJECT_ID, { ...validFields, lines: [line(PART_A, 4, 1), line(PART_C, 2)] });

    const { queue } = await service.update(PROJECT_ID, {
      version: 1,
      lines: [line(PART_A, 4, 1), line(PART_C, 5, 3)],
    });

    expect(queue.lines).toEqual([line(PART_A, 4, 1), line(PART_C, 5, 3)]);
    // Only the final detail lookup ran; the edit itself asked for no part.
    expect(ports.partCalls.slice(0, -1)).toEqual([]);
  });

  it('still rejects a NEW line with a missing part', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID, { ...validFields, lines: [line(PART_C, 2)] });

    const error = await failureOf(
      service.update(PROJECT_ID, { version: 1, lines: [line(PART_C, 2), line('9'.repeat(24), 1)] }),
    );

    expect(error.issues).toEqual([{ path: 'lines.1.partId', message: 'The part does not exist.' }]);
  });

  it('replaces the lines and reports a missing part by index', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);

    const error = await failureOf(
      service.update(PROJECT_ID, { version: 1, lines: [line(PART_B, 1), line(PART_C, 1)] }),
    );

    expect(error.issues).toEqual([{ path: 'lines.1.partId', message: 'The part does not exist.' }]);
  });
});

describe('remove', () => {
  it('deletes with the matching version', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);

    await service.remove(PROJECT_ID, 1);

    expect(repository.stored.size).toBe(0);
  });

  it('answers 409 for a stale version and keeps the queue', async () => {
    const { service, repository } = setup();
    repository.seed(PROJECT_ID);

    expect((await failureOf(service.remove(PROJECT_ID, 2))).code).toBe('conflict');
    expect(repository.stored.size).toBe(1);
  });

  it('answers 404 when there is no queue', async () => {
    expect((await failureOf(setup().service.remove(PROJECT_ID, 1))).code).toBe('not_found');
  });
});
