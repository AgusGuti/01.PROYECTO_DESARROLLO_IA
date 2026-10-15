// Test doubles for the filaments module: a plain-object in-memory repository and a movable clock.
// Used by service and route tests; the real repository has its own integration tests.
import type { Clock } from '../../health/index.js';
import type {
  Filament,
  FilamentFields,
  FilamentListQuery,
  FilamentPatch,
} from '../filaments.domain.js';
import { mergeFilament } from '../filaments.domain.js';
import type { FilamentRepository } from '../filaments.service.js';

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

export const validFields: FilamentFields = {
  brand: 'Grilon3',
  material: 'PLA',
  colorName: 'Negro',
  initialGrams: 1000,
  availableGrams: 1000,
  purchaseCostMinor: 1_950_000,
  purchaseDate: new Date('2026-02-01T00:00:00.000Z'),
};

export interface FakeFilamentRepository extends FilamentRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  /** Every stored filament, deleted ones included. */
  readonly stored: Map<string, Filament>;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
  /** Inserts a filament directly in any state, bypassing the use cases. */
  seed(overrides?: Partial<Filament>): Filament;
}

export function createFakeFilamentRepository(): FakeFilamentRepository {
  const stored = new Map<string, Filament>();
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

  const live = (id: string): Filament | undefined => {
    const filament = stored.get(id);
    return filament?.deletedAt === null ? filament : undefined;
  };

  const repository: FakeFilamentRepository = {
    calls,
    stored,
    failWith: undefined,

    seed(overrides = {}) {
      const filament: Filament = {
        ...validFields,
        id: nextId(),
        version: 1,
        deletedAt: null,
        createdAt: epoch,
        updatedAt: epoch,
        ...overrides,
      };
      stored.set(filament.id, filament);
      return filament;
    },

    create(fields, now) {
      guard('create');
      const filament: Filament = {
        ...fields,
        id: nextId(),
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      stored.set(filament.id, filament);
      return Promise.resolve(filament);
    },

    findLiveById(id) {
      guard('findLiveById');
      return Promise.resolve(live(id) ?? null);
    },

    list(query: FilamentListQuery) {
      guard('list');
      const keyOf = (f: Filament): number | string => {
        switch (query.sort) {
          case 'brand':
            return f.brand.toLowerCase();
          case 'purchaseDate':
            return f.purchaseDate.getTime();
          case 'availableGrams':
            return f.availableGrams;
          case 'createdAt':
            return f.createdAt.getTime();
        }
      };
      const matching = [...stored.values()]
        .filter((f) => f.deletedAt === null)
        .filter((f) => query.material === undefined || f.material === query.material)
        .filter((f) => query.inStock === undefined || f.availableGrams > 0 === query.inStock)
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

    update(id, version, patch: FilamentPatch, now) {
      guard('update');
      const current = live(id);
      if (current?.version !== version) return Promise.resolve(null);
      const updated: Filament = {
        ...current,
        ...mergeFilament(current, patch),
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
      const updated: Filament = {
        ...current,
        deletedAt: now,
        version: current.version + 1,
        updatedAt: now,
      };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },

    // Same filter as the real atomic update: live and enough material, nothing else.
    consume(id, grams, now) {
      guard('consume');
      const current = live(id);
      if (current === undefined || current.availableGrams < grams) return Promise.resolve(null);
      const updated: Filament = {
        ...current,
        availableGrams: current.availableGrams - grams,
        version: current.version + 1,
        updatedAt: now,
      };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },
  };

  return repository;
}
