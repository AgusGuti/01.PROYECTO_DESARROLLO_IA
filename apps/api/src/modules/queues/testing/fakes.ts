// Test doubles for the queues module: in-memory repository, the three ports and a movable clock.
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../health/index.js';
import type { FilamentInfo, PartInfo, Queue, QueueFields, QueueLine } from '../queues.domain.js';
import type {
  FilamentLookup,
  PartLookup,
  PrinterLookup,
  ProjectReader,
  QueueRepository,
} from '../queues.service.js';

export function createTestClock(start = '2026-03-01T10:00:00.000Z'): Clock {
  const current = new Date(start);
  return { now: () => new Date(current) };
}

/** Ids used in tests: 24 hex characters. */
export const PROJECT_ID = '1'.repeat(24);
export const PART_A = 'a'.repeat(24);
export const PART_B = 'b'.repeat(24);
export const PART_C = 'c'.repeat(24);
export const PRINTER_1 = 'd'.repeat(24);
export const PRINTER_2 = 'e'.repeat(24);
export const PRINTER_3 = 'f'.repeat(24);

export const SPOOL_1 = '7'.repeat(24);
export const SPOOL_2 = '8'.repeat(24);

export const line = (
  partId: string,
  quantity: number,
  completed = 0,
  filamentId: string | null = SPOOL_1,
): QueueLine => ({
  partId,
  filamentId,
  quantity,
  completed,
});

export const validFields: QueueFields = {
  goal: 'fastest',
  mode: 'single',
  printerIds: [PRINTER_1],
  lines: [line(PART_A, 4, 1)],
};

export interface FakeQueueRepository extends QueueRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  readonly stored: Map<string, Queue>;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
  seed(id: string, fields?: QueueFields, version?: number): Queue;
}

export function createFakeQueueRepository(): FakeQueueRepository {
  const guard = (name: string): void => {
    repository.calls.push(name);
    if (repository.failWith !== undefined) throw repository.failWith;
  };

  const repository: FakeQueueRepository = {
    calls: [],
    stored: new Map(),
    failWith: undefined,

    seed(id, fields = validFields, version = 1) {
      const at = new Date('2026-02-01T00:00:00.000Z');
      const queue: Queue = { id, ...fields, version, createdAt: at, updatedAt: at };
      repository.stored.set(id, queue);
      return queue;
    },

    create(id, fields, now) {
      guard('create');
      if (repository.stored.has(id)) {
        return Promise.reject(
          new AppError('conflict', 'The project already has a queue.', {
            issues: [{ path: 'projectId', message: 'The project already has a queue.' }],
          }),
        );
      }
      const created: Queue = { id, ...fields, version: 1, createdAt: now, updatedAt: now };
      repository.stored.set(id, created);
      return Promise.resolve(created);
    },

    findById(id) {
      guard('findById');
      return Promise.resolve(repository.stored.get(id) ?? null);
    },

    update(id, version, patch, now) {
      guard('update');
      const current = repository.stored.get(id);
      if (current?.version !== version) return Promise.resolve(null);
      const updated: Queue = {
        ...current,
        goal: patch.goal ?? current.goal,
        mode: patch.mode ?? current.mode,
        printerIds: patch.printerIds ?? current.printerIds,
        lines: patch.lines ?? current.lines,
        version: version + 1,
        updatedAt: now,
      };
      repository.stored.set(id, updated);
      return Promise.resolve(updated);
    },

    hasPendingWorkFor(printerId) {
      guard('hasPendingWorkFor');
      const pending = [...repository.stored.values()].some(
        (queue) =>
          queue.printerIds.includes(printerId) &&
          queue.lines.some((entry) => entry.completed < entry.quantity),
      );
      return Promise.resolve(pending);
    },

    remove(id, version) {
      guard('remove');
      if (repository.stored.get(id)?.version !== version) return Promise.resolve(false);
      repository.stored.delete(id);
      return Promise.resolve(true);
    },
  };
  return repository;
}

export interface FakePorts {
  readonly projectReader: ProjectReader;
  readonly partLookup: PartLookup;
  readonly filamentLookup: FilamentLookup;
  readonly printerLookup: PrinterLookup;
  /** project id -> its lines. Anything else is unknown or removed. */
  readonly projects: Map<string, { partId: string; filamentId: string | null; quantity: number }[]>;
  readonly parts: Map<string, PartInfo>;
  /** The live spools. Anything else is unknown or deleted. */
  readonly filaments: Map<string, FilamentInfo>;
  /** Live, not archived printers. */
  readonly printers: Set<string>;
  /** The ids asked on every part lookup, in order. */
  readonly partCalls: string[][];
  /** When set, the named port rejects with this error (a dependency failure). */
  failing: 'project' | 'parts' | 'filaments' | 'printers' | undefined;
}

export function createFakePorts(): FakePorts {
  const ports: FakePorts = {
    projects: new Map([
      [
        PROJECT_ID,
        [
          { partId: PART_A, filamentId: SPOOL_1, quantity: 4 },
          { partId: PART_B, filamentId: SPOOL_2, quantity: 2 },
        ],
      ],
    ]),
    parts: new Map([
      [PART_A, { name: 'Soporte en L', estimatedPrintSeconds: 3600 }],
      [PART_B, { name: 'Florero', estimatedPrintSeconds: 600 }],
    ]),
    filaments: new Map<string, FilamentInfo>([
      [SPOOL_1, { brand: 'Grilon3', material: 'PETG', colorName: 'Negro', availableGrams: 800 }],
      [SPOOL_2, { brand: 'Printalot', material: 'PLA', colorName: 'Rojo', availableGrams: 450 }],
    ]),
    printers: new Set([PRINTER_1, PRINTER_2, PRINTER_3]),
    partCalls: [],
    failing: undefined,

    projectReader(id) {
      if (ports.failing === 'project') return Promise.reject(new Error('boom'));
      const items = ports.projects.get(id);
      return Promise.resolve(items === undefined ? null : { items });
    },
    partLookup(ids) {
      ports.partCalls.push([...ids]);
      if (ports.failing === 'parts') return Promise.reject(new Error('boom'));
      const found = new Map<string, PartInfo>();
      for (const id of ids) {
        const part = ports.parts.get(id);
        if (part !== undefined) found.set(id, part);
      }
      return Promise.resolve(found);
    },
    filamentLookup(ids) {
      if (ports.failing === 'filaments') return Promise.reject(new Error('boom'));
      const found = new Map<string, FilamentInfo>();
      for (const id of ids) {
        const spool = ports.filaments.get(id);
        if (spool !== undefined) found.set(id, spool);
      }
      return Promise.resolve(found);
    },
    printerLookup(ids) {
      if (ports.failing === 'printers') return Promise.reject(new Error('boom'));
      return Promise.resolve(new Set(ids.filter((id) => ports.printers.has(id))));
    },
  };
  return ports;
}
