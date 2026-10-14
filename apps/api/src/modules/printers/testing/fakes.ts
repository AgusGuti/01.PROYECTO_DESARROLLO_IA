// Test doubles for the printers module: a plain-object in-memory repository and a movable clock.
// Used by service and route tests; the real repository has its own integration tests.
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../health/index.js';
import type { Printer, PrinterFields, PrinterListQuery, PrinterPatch } from '../printers.domain.js';
import { mergePrinter } from '../printers.domain.js';
import type { PrinterRepository } from '../printers.service.js';

export function createTestClock(start = '2026-03-01T10:00:00.000Z'): Clock & {
  advanceSeconds(seconds: number): void;
} {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advanceSeconds(seconds) {
      current = new Date(current.getTime() + seconds * 1000);
    },
  };
}

export const validFields: PrinterFields = {
  name: 'Ender 3',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.4, material: 'brass' },
  compatibleMaterials: ['PLA', 'PETG'],
  typicalSpeedMmS: 60,
  status: 'available',
};

export interface FakePrinterRepository extends PrinterRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  /** Every stored printer, deleted ones included. */
  readonly stored: Map<string, Printer>;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
  /** Inserts a printer directly in any state, bypassing the use cases. */
  seed(overrides?: Partial<Printer>): Printer;
}

export function createFakePrinterRepository(): FakePrinterRepository {
  const stored = new Map<string, Printer>();
  const calls: string[] = [];
  let counter = 0;
  const epoch = new Date('2026-01-01T00:00:00.000Z');

  const nextId = (): string => {
    counter += 1;
    return counter.toString(16).padStart(24, '0');
  };

  const guard = (name: string): void => {
    calls.push(name);
    if (repository.failWith !== undefined) throw repository.failWith;
  };

  const live = (id: string): Printer | undefined => {
    const printer = stored.get(id);
    return printer?.deletedAt === null ? printer : undefined;
  };

  // Deleted printers keep their name reserved, like the real unique index.
  const holderOf = (name: string, exceptId?: string): Printer | undefined =>
    [...stored.values()].find(
      (printer) => printer.id !== exceptId && printer.name.toLowerCase() === name.toLowerCase(),
    );

  const duplicate = (holder?: Printer): AppError =>
    holder?.deletedAt
      ? new AppError('conflict', 'A printer with this name already exists.', {
          issues: [
            {
              path: 'restoreIfDeleted',
              message:
                'A deleted printer with this name exists; resend with restoreIfDeleted true to restore it with the submitted data.',
            },
          ],
        })
      : new AppError('conflict', 'A printer with this name already exists.', {
          issues: [{ path: 'name', message: 'Another printer already uses this name.' }],
        });

  const repository: FakePrinterRepository = {
    calls,
    stored,
    failWith: undefined,

    seed(overrides = {}) {
      const printer: Printer = {
        ...validFields,
        id: nextId(),
        version: 1,
        archivedAt: null,
        deletedAt: null,
        createdAt: epoch,
        updatedAt: epoch,
        ...overrides,
      };
      stored.set(printer.id, printer);
      return printer;
    },

    create(fields, now) {
      guard('create');
      const holder = holderOf(fields.name);
      if (holder !== undefined) return Promise.reject(duplicate(holder));
      const printer: Printer = {
        ...fields,
        id: nextId(),
        version: 1,
        archivedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      stored.set(printer.id, printer);
      return Promise.resolve(printer);
    },

    restore(fields, now) {
      guard('restore');
      const holder = holderOf(fields.name);
      if (holder === undefined || holder.deletedAt === null) return Promise.resolve(null);
      const restored: Printer = {
        ...holder,
        ...fields,
        deletedAt: null,
        archivedAt: null,
        version: holder.version + 1,
        updatedAt: now,
      };
      stored.set(restored.id, restored);
      return Promise.resolve(restored);
    },

    unarchive(id, now) {
      guard('unarchive');
      const current = live(id);
      if (current === undefined || current.archivedAt === null) return Promise.resolve(null);
      const updated: Printer = {
        ...current,
        archivedAt: null,
        version: current.version + 1,
        updatedAt: now,
      };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },

    findLiveById(id) {
      guard('findLiveById');
      return Promise.resolve(live(id) ?? null);
    },

    list(query: PrinterListQuery) {
      guard('list');
      const matching = [...stored.values()]
        .filter((p) => p.deletedAt === null)
        .filter((p) => query.status === undefined || p.status === query.status)
        .sort((a, b) => {
          const byKey =
            query.sort === 'name'
              ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
              : a.createdAt.getTime() - b.createdAt.getTime();
          const ordered = byKey !== 0 ? byKey : a.id.localeCompare(b.id);
          return query.order === 'asc' ? ordered : -ordered;
        });
      const start = (query.page - 1) * query.pageSize;
      return Promise.resolve({
        items: matching.slice(start, start + query.pageSize),
        total: matching.length,
      });
    },

    update(id, version, patch: PrinterPatch, now) {
      guard('update');
      const current = live(id);
      if (current?.version !== version) {
        return Promise.resolve(null);
      }
      const merged = mergePrinter(current, patch);
      const holder = holderOf(merged.name, id);
      // A rename onto a deleted name is a plain "name" conflict (restoring is only for create).
      if (holder !== undefined) return Promise.reject(duplicate({ ...holder, deletedAt: null }));
      const updated: Printer = { ...current, ...merged, version: version + 1, updatedAt: now };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },

    archive(id, now) {
      guard('archive');
      const current = live(id);
      if (current?.archivedAt !== null) {
        return Promise.resolve(null);
      }
      const updated: Printer = {
        ...current,
        archivedAt: now,
        version: current.version + 1,
        updatedAt: now,
      };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },

    softDelete(id, now) {
      guard('softDelete');
      const current = live(id);
      if (current?.archivedAt !== null || current.status === 'in_use') {
        return Promise.resolve(null);
      }
      const updated: Printer = {
        ...current,
        deletedAt: now,
        version: current.version + 1,
        updatedAt: now,
      };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },
  };

  return repository;
}
