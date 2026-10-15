// Test doubles for the parts module: a plain-object in-memory repository and a movable clock.
// Used by service and route tests; the real repository has its own integration tests.
import type { Clock } from '../../health/index.js';
import type { Part, PartFields, PartPatch } from '../parts.domain.js';
import type { PartRepository, PartUsage, PartUsageReport } from '../parts.service.js';

/**
 * What a PATCH produces: `undefined` keeps the current value, `null` clears a text. The real rules
 * live in the repository's `$set` builder and are proven by the integration tests; this only
 * mirrors them for the tests that use the fake.
 */
function applyPatch(current: PartFields, patch: PartPatch): PartFields {
  return {
    name: patch.name ?? current.name,
    description: patch.description === undefined ? current.description : patch.description,
    material: patch.material ?? current.material,
    dimensionsMm: patch.dimensionsMm ?? current.dimensionsMm,
    estimatedWeightGrams: patch.estimatedWeightGrams ?? current.estimatedWeightGrams,
    estimatedPrintSeconds: patch.estimatedPrintSeconds ?? current.estimatedPrintSeconds,
    layerHeightUm: patch.layerHeightUm ?? current.layerHeightUm,
    suggestedPrinterName:
      patch.suggestedPrinterName === undefined
        ? current.suggestedPrinterName
        : patch.suggestedPrinterName,
    source: patch.source ?? current.source,
  };
}

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

export const validFields: PartFields = {
  name: 'Soporte de estante en L',
  description: null,
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: 5700,
  layerHeightUm: 200,
  suggestedPrinterName: null,
  source: { kind: 'manual' },
};

export interface FakePartRepository extends PartRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  /** Every stored part, deleted ones included. */
  readonly stored: Map<string, Part>;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
  /** Inserts a part directly in any state, bypassing the use cases. */
  seed(overrides?: Partial<Part>): Part;
}

export function createFakePartRepository(): FakePartRepository {
  const stored = new Map<string, Part>();
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

  const live = (id: string): Part | undefined => {
    const part = stored.get(id);
    return part?.deletedAt === null ? part : undefined;
  };

  const repository: FakePartRepository = {
    calls,
    stored,
    failWith: undefined,

    seed(overrides = {}) {
      const part: Part = {
        ...validFields,
        id: nextId(),
        version: 1,
        deletedAt: null,
        createdAt: epoch,
        updatedAt: epoch,
        ...overrides,
      };
      stored.set(part.id, part);
      return part;
    },

    create(fields, now) {
      guard('create');
      const part: Part = {
        ...fields,
        id: nextId(),
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      stored.set(part.id, part);
      return Promise.resolve(part);
    },

    findLiveById(id) {
      guard('findLiveById');
      return Promise.resolve(live(id) ?? null);
    },

    list(query) {
      guard('list');
      const keyOf = (p: Part): number | string => {
        switch (query.sort) {
          case 'name':
            return p.name.toLowerCase();
          case 'createdAt':
            return p.createdAt.getTime();
          case 'estimatedWeightGrams':
            return p.estimatedWeightGrams;
          case 'estimatedPrintSeconds':
            return p.estimatedPrintSeconds;
        }
      };
      const matching = [...stored.values()]
        .filter((p) => p.deletedAt === null)
        .filter((p) => query.material === undefined || p.material === query.material)
        .sort((a, b) => {
          const ka = keyOf(a);
          const kb = keyOf(b);
          let byKey = 0;
          if (ka < kb) byKey = -1;
          else if (ka > kb) byKey = 1;
          const ordered = byKey !== 0 ? byKey : a.id.localeCompare(b.id);
          return query.order === 'asc' ? ordered : -ordered;
        });
      const start = (query.page - 1) * query.pageSize;
      return Promise.resolve({
        items: matching.slice(start, start + query.pageSize),
        total: matching.length,
      });
    },

    findLiveByIds(ids) {
      guard('findLiveByIds');
      return Promise.resolve(
        ids.flatMap((id) => {
          const part = live(id);
          return part === undefined
            ? []
            : [{ id: part.id, name: part.name, material: part.material }];
        }),
      );
    },

    update(id, version, patch, now) {
      guard('update');
      const current = live(id);
      if (current?.version !== version) return Promise.resolve(null);
      const updated: Part = {
        ...current,
        ...applyPatch(current, patch),
        version: version + 1,
        updatedAt: now,
      };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },

    softDelete(id, now) {
      guard('softDelete');
      const current = live(id);
      if (current === undefined) return Promise.resolve(null);
      const updated: Part = {
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

export interface FakePartUsage extends PartUsage {
  /** Calls in order, such as `removeFromProjects:<id>`. */
  readonly calls: string[];
  /** What `listProjects` answers. */
  report: PartUsageReport;
  /** Projects pulled by `removeFromProjects`. */
  pulled: number;
  /** When set, both methods reject with this error (a dependency failure). */
  failWith: Error | undefined;
}

/** A plain-object stand-in for the projects module's usage port. Unused by default. */
export function createFakePartUsage(
  report: PartUsageReport = { total: 0, projects: [] },
): FakePartUsage {
  const usage: FakePartUsage = {
    calls: [],
    report,
    pulled: 0,
    failWith: undefined,
    listProjects(partId, limit) {
      usage.calls.push(`listProjects:${partId}:${String(limit)}`);
      if (usage.failWith !== undefined) return Promise.reject(usage.failWith);
      return Promise.resolve({
        total: usage.report.total,
        projects: usage.report.projects.slice(0, limit),
      });
    },
    removeFromProjects(partId) {
      usage.calls.push(`removeFromProjects:${partId}`);
      if (usage.failWith !== undefined) return Promise.reject(usage.failWith);
      return Promise.resolve(usage.pulled);
    },
  };
  return usage;
}
