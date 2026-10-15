// Test doubles for the projects module: plain-object in-memory repository, part lookup and clock.
// Used by service and route tests; the real repository has its own integration tests.
import type { Clock } from '../../health/index.js';
import {
  PRIORITIES,
  type PartSummary,
  type Project,
  type ProjectFields,
  type ProjectPatch,
} from '../projects.domain.js';
import type { PartLookup, ProjectRepository } from '../projects.service.js';

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

export const validFields: ProjectFields = {
  name: 'Soportes para el taller',
  description: null,
  priority: 'normal',
  deadline: null,
  items: [],
};

/** Part ids used in tests: 24 hex characters. */
export const PART_A = 'a'.repeat(24);
export const PART_B = 'b'.repeat(24);
export const PART_C = 'c'.repeat(24);

export interface FakePartLookup {
  readonly lookup: PartLookup;
  /** The ids asked on every call, in order. */
  readonly calls: string[][];
  /** The live parts. Anything else is unknown or deleted. */
  readonly live: Map<string, PartSummary>;
  /** When set, the lookup rejects with this error (a dependency failure). */
  failWith: Error | undefined;
}

export function createFakePartLookup(
  parts: Record<string, PartSummary> = {
    [PART_A]: { name: 'Soporte de estante en L', material: 'PETG' },
    [PART_B]: { name: 'Florero espiral', material: 'PLA' },
  },
): FakePartLookup {
  const fake: FakePartLookup = {
    calls: [],
    live: new Map(Object.entries(parts)),
    failWith: undefined,
    lookup(ids) {
      fake.calls.push([...ids]);
      if (fake.failWith !== undefined) return Promise.reject(fake.failWith);
      const found = new Map<string, PartSummary>();
      for (const id of ids) {
        const part = fake.live.get(id);
        if (part !== undefined) found.set(id, part);
      }
      return Promise.resolve(found);
    },
  };
  return fake;
}

/** What a PATCH produces: `undefined` keeps the current value, `null` clears. */
function applyPatch(current: ProjectFields, patch: ProjectPatch): ProjectFields {
  return {
    name: patch.name ?? current.name,
    description: patch.description === undefined ? current.description : patch.description,
    priority: patch.priority ?? current.priority,
    deadline: patch.deadline === undefined ? current.deadline : patch.deadline,
    items: patch.items ?? current.items,
  };
}

export interface FakeProjectRepository extends ProjectRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  /** Every stored project, deleted ones included. */
  readonly stored: Map<string, Project>;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
  /** Inserts a project directly in any state, bypassing the use cases. */
  seed(overrides?: Partial<Project>): Project;
}

export function createFakeProjectRepository(): FakeProjectRepository {
  const stored = new Map<string, Project>();
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

  const live = (id: string): Project | undefined => {
    const project = stored.get(id);
    return project?.deletedAt === null ? project : undefined;
  };

  const byName = (a: Project, b: Project): number =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'accent' }) || a.id.localeCompare(b.id);

  const repository: FakeProjectRepository = {
    calls,
    stored,
    failWith: undefined,

    seed(overrides = {}) {
      const project: Project = {
        ...validFields,
        id: nextId(),
        version: 1,
        deletedAt: null,
        createdAt: epoch,
        updatedAt: epoch,
        ...overrides,
      };
      stored.set(project.id, project);
      return project;
    },

    create(fields, now) {
      guard('create');
      const project: Project = {
        ...fields,
        id: nextId(),
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      stored.set(project.id, project);
      return Promise.resolve(project);
    },

    findLiveById(id) {
      guard('findLiveById');
      return Promise.resolve(live(id) ?? null);
    },

    list(query) {
      guard('list');
      const compare = (a: Project, b: Project): number => {
        switch (query.sort) {
          case 'priority':
            return PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
          case 'name':
            return a.name.localeCompare(b.name, 'es', { sensitivity: 'accent' });
          case 'createdAt':
            return a.createdAt.getTime() - b.createdAt.getTime();
          case 'deadline':
            return (a.deadline?.getTime() ?? 0) - (b.deadline?.getTime() ?? 0);
        }
      };
      const sign = query.order === 'asc' ? 1 : -1;
      const matching = [...stored.values()]
        .filter((p) => p.deletedAt === null)
        .filter((p) => query.priority === undefined || p.priority === query.priority)
        .sort((a, b) => {
          // Without a deadline comes last in both directions.
          if (query.sort === 'deadline' && (a.deadline === null) !== (b.deadline === null)) {
            return a.deadline === null ? 1 : -1;
          }
          return sign * (compare(a, b) || a.id.localeCompare(b.id));
        });
      const start = (query.page - 1) * query.pageSize;
      return Promise.resolve({
        items: matching.slice(start, start + query.pageSize),
        total: matching.length,
      });
    },

    update(id, version, patch, now) {
      guard('update');
      const current = live(id);
      if (current?.version !== version) return Promise.resolve(null);
      const updated: Project = {
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
      const updated: Project = {
        ...current,
        deletedAt: now,
        version: current.version + 1,
        updatedAt: now,
      };
      stored.set(id, updated);
      return Promise.resolve(updated);
    },

    usageOfPart(partId, limit) {
      guard('usageOfPart');
      const using = [...stored.values()]
        .filter((p) => p.deletedAt === null && p.items.some((item) => item.partId === partId))
        .sort(byName);
      return Promise.resolve({
        total: using.length,
        projects: using.slice(0, limit).map((p) => ({
          id: p.id,
          name: p.name,
          quantity: p.items.find((item) => item.partId === partId)?.quantity ?? 0,
        })),
      });
    },

    pullPart(partId, now) {
      guard('pullPart');
      let changed = 0;
      for (const project of [...stored.values()]) {
        if (project.deletedAt !== null || !project.items.some((i) => i.partId === partId)) continue;
        stored.set(project.id, {
          ...project,
          items: project.items.filter((item) => item.partId !== partId),
          version: project.version + 1,
          updatedAt: now,
        });
        changed += 1;
      }
      return Promise.resolve(changed);
    },
  };

  return repository;
}
