// Use cases for projects (CU01). Knows nothing about HTTP or MongoDB: it talks to a repository
// interface, to the part lookup port (ADR 0017) and to the injected clock.
import { AppError } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import {
  duplicatedItemIssues,
  missingPartIssues,
  type PartSummary,
  type Project,
  type ProjectDetail,
  type ProjectFields,
  type ProjectItem,
  type ProjectListQuery,
  type ProjectPage,
  type ProjectPatch,
  type ProjectUsage,
} from './projects.domain.js';

/**
 * Persistence port. Every method returns plain objects. Methods that write return `null` when
 * the conditional update matched nothing; the service decides what that means.
 */
export interface ProjectRepository {
  create(fields: ProjectFields, now: Date): Promise<Project>;
  /** A project that exists and is not deleted. */
  findLiveById(id: string): Promise<Project | null>;
  list(query: ProjectListQuery): Promise<ProjectPage>;
  /** One atomic write guarded by `{ id, version, not deleted }`; bumps the version. */
  update(id: string, version: number, patch: ProjectPatch, now: Date): Promise<Project | null>;
  /** One atomic write guarded by `{ id, not deleted }`; bumps the version. */
  softDelete(id: string, now: Date): Promise<Project | null>;
  /** Live projects with a line for the part: the true total and at most `limit` of them. */
  usageOfPart(partId: string, limit: number): Promise<ProjectUsage>;
  /** Pulls the part's lines from every live project in one write. Returns how many changed. */
  pullPart(partId: string, now: Date): Promise<number>;
}

/**
 * Port owned by this module (ADR 0017): which of these parts are live, with their name and
 * material. An id missing from the answer is unknown or deleted. One call, never one per line.
 */
export type PartLookup = (ids: string[]) => Promise<ReadonlyMap<string, PartSummary>>;

export interface NewProject {
  readonly name: string;
  readonly description?: string | undefined;
  readonly priority: ProjectFields['priority'];
  readonly deadline?: Date | undefined;
  readonly items: readonly ProjectItem[];
}

/** A partial edit as validated at the border. */
export interface ProjectEdit extends ProjectPatch {
  readonly version: number;
}

export interface ProjectsService {
  create(input: NewProject): Promise<ProjectDetail>;
  get(id: string): Promise<ProjectDetail>;
  list(query: ProjectListQuery): Promise<ProjectPage>;
  update(id: string, edit: ProjectEdit): Promise<ProjectDetail>;
  remove(id: string): Promise<void>;
  /** Pass-through for the parts module (ADR 0017). */
  usageOfPart(partId: string, limit: number): Promise<ProjectUsage>;
  /** Pass-through for the parts module (ADR 0018). */
  removePartFromProjects(partId: string, now: Date): Promise<number>;
}

const notFound = (): AppError => new AppError('not_found', 'The project does not exist.');

function staleVersion(): AppError {
  return new AppError('conflict', 'The project was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });
}

export function createProjectsService(deps: {
  repository: ProjectRepository;
  partLookup: PartLookup;
  clock: Clock;
}): ProjectsService {
  const { repository, clock } = deps;

  /** Fails closed: a lookup that breaks is a 503, never "no part exists". */
  async function lookup(items: readonly ProjectItem[]): Promise<ReadonlyMap<string, PartSummary>> {
    if (items.length === 0) return new Map();
    try {
      return await deps.partLookup([...new Set(items.map((item) => item.partId))]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('service_unavailable', 'The part data is temporarily unavailable.', {
        cause: error,
      });
    }
  }

  /** Duplicates first, then the lookup. Returns the parts for the response. */
  async function validateItems(
    items: readonly ProjectItem[],
  ): Promise<ReadonlyMap<string, PartSummary>> {
    const duplicates = duplicatedItemIssues(items);
    if (duplicates.length > 0) {
      throw new AppError('validation_failed', 'The request is not valid.', { issues: duplicates });
    }
    const parts = await lookup(items);
    const missing = missingPartIssues(items, new Set(parts.keys()));
    if (missing.length > 0) {
      throw new AppError('validation_failed', 'The request is not valid.', { issues: missing });
    }
    return parts;
  }

  return {
    async create(input) {
      const parts = await validateItems(input.items);
      const now = clock.now();
      const project = await repository.create(
        {
          name: input.name,
          description: input.description ?? null,
          priority: input.priority,
          deadline: input.deadline ?? null,
          items: input.items.map((item) => ({ partId: item.partId, quantity: item.quantity })),
        },
        now,
      );
      return { project, parts };
    },

    async get(id) {
      const project = await repository.findLiveById(id);
      if (project === null) throw notFound();
      return { project, parts: await lookup(project.items) };
    },

    list(query) {
      return repository.list(query);
    },

    async update(id, edit) {
      const { version, ...patch } = edit;
      const current = await repository.findLiveById(id);
      if (current === null) throw notFound();
      if (current.version !== version) throw staleVersion();
      // Only a patch that carries the lines is checked against the parts.
      const checked = patch.items === undefined ? undefined : await validateItems(patch.items);

      const updated = await repository.update(id, version, patch, clock.now());
      if (updated === null) {
        // The conditional write matched nothing: look again only to say why.
        if ((await repository.findLiveById(id)) === null) throw notFound();
        throw staleVersion();
      }
      return { project: updated, parts: checked ?? (await lookup(updated.items)) };
    },

    async remove(id) {
      // Missing and already deleted look the same: nothing live matched.
      if ((await repository.softDelete(id, clock.now())) === null) throw notFound();
    },

    usageOfPart(partId, limit) {
      return repository.usageOfPart(partId, limit);
    },

    removePartFromProjects(partId, now) {
      return repository.pullPart(partId, now);
    },
  };
}
