// Use cases for parts (CU02). Knows nothing about HTTP or MongoDB: it talks to a repository
// interface and to the injected clock.
import { AppError } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import {
  stampSource,
  type Part,
  type PartFields,
  type PartListQuery,
  type PartPage,
  type PartPatch,
  type SourceInput,
} from './parts.domain.js';

/**
 * Persistence port. Every method returns plain objects. Methods that write return `null` when
 * the conditional update matched nothing; the service decides what that means.
 */
export interface PartRepository {
  create(fields: PartFields, now: Date): Promise<Part>;
  /** A part that exists and is not deleted. */
  findLiveById(id: string): Promise<Part | null>;
  list(query: PartListQuery): Promise<PartPage>;
  /** One atomic write guarded by `{ id, version, not deleted }`; bumps the version. */
  update(id: string, version: number, patch: PartPatch, now: Date): Promise<Part | null>;
  /** One atomic write guarded by `{ id, not deleted }`; bumps the version. */
  softDelete(id: string, now: Date): Promise<Part | null>;
  /** Name and material of the live parts among `ids` (a single query). */
  findLiveByIds(ids: readonly string[]): Promise<LivePartSummary[]>;
}

export interface LivePartSummary {
  readonly id: string;
  readonly name: string;
  readonly material: Part['material'];
}

export interface PartUsageProject {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
}

export interface PartUsageReport {
  /** The true number of live projects that use the part. */
  readonly total: number;
  readonly projects: readonly PartUsageProject[];
}

/**
 * Port owned by this module (ADR 0017): the projects that use a part. The projects module
 * implements it structurally and app.ts connects them.
 */
export interface PartUsage {
  /** Live projects that use the part: the true total and at most `limit` of them. */
  listProjects(partId: string, limit: number): Promise<PartUsageReport>;
  /** Pulls the part from every live project. Idempotent. Returns how many projects changed. */
  removeFromProjects(partId: string, now: Date): Promise<number>;
}

/** The usage endpoint lists at most this many projects; `total` is always the true count. */
export const USAGE_LIST_LIMIT = 50;

export interface NewPart {
  readonly name: string;
  readonly description?: string | undefined;
  readonly material: PartFields['material'];
  readonly dimensionsMm: PartFields['dimensionsMm'];
  readonly estimatedWeightGrams: number;
  readonly estimatedPrintSeconds: number;
  readonly layerHeightUm: number;
  readonly suggestedPrinterName?: string | undefined;
  /** Defaults to manual. */
  readonly source?: SourceInput | undefined;
}

/** A partial edit as validated at the border: its `source` has no `analyzedAt` yet. */
export interface PartEdit extends Omit<PartPatch, 'source'> {
  readonly version: number;
  readonly source?: SourceInput | undefined;
}

export interface PartsService {
  create(input: NewPart): Promise<Part>;
  get(id: string): Promise<Part>;
  list(query: PartListQuery): Promise<PartPage>;
  update(id: string, edit: PartEdit): Promise<Part>;
  /** `removeFromProjects: true` is the confirmation of ADR 0018. */
  remove(id: string, options?: { removeFromProjects?: boolean }): Promise<void>;
  usage(id: string): Promise<PartUsageReport>;
}

const notFound = (): AppError => new AppError('not_found', 'The part does not exist.');

function staleVersion(): AppError {
  return new AppError('conflict', 'The part was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });
}

export function createPartsService(deps: {
  repository: PartRepository;
  partUsage: PartUsage;
  clock: Clock;
}): PartsService {
  const { repository, partUsage, clock } = deps;

  /** Fails closed: if usage cannot be known, nothing is deleted (503). */
  async function viaUsage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('service_unavailable', 'The project data is temporarily unavailable.', {
        cause: error,
      });
    }
  }

  return {
    async create(input) {
      const now = clock.now();
      const fields: PartFields = {
        name: input.name,
        description: input.description ?? null,
        material: input.material,
        dimensionsMm: input.dimensionsMm,
        estimatedWeightGrams: input.estimatedWeightGrams,
        estimatedPrintSeconds: input.estimatedPrintSeconds,
        layerHeightUm: input.layerHeightUm,
        suggestedPrinterName: input.suggestedPrinterName ?? null,
        source: stampSource(input.source ?? { kind: 'manual' }, now),
      };
      return repository.create(fields, now);
    },

    async get(id) {
      const part = await repository.findLiveById(id);
      if (part === null) throw notFound();
      return part;
    },

    list(query) {
      return repository.list(query);
    },

    async update(id, edit) {
      const { version, source, ...rest } = edit;
      const current = await repository.findLiveById(id);
      if (current === null) throw notFound();
      if (current.version !== version) throw staleVersion();
      const now = clock.now();
      // Only a patch that carries a source is stamped again.
      const patch: PartPatch = {
        ...rest,
        ...(source === undefined ? {} : { source: stampSource(source, now) }),
      };

      const updated = await repository.update(id, version, patch, now);
      if (updated !== null) return updated;

      // The conditional write matched nothing: look again only to say why.
      if ((await repository.findLiveById(id)) === null) throw notFound();
      throw staleVersion();
    },

    async remove(id, options = {}) {
      if ((await repository.findLiveById(id)) === null) throw notFound();

      if (options.removeFromProjects === true) {
        // Pull first (ADR 0018): a failure in between leaves a live part with fewer lines,
        // which a retry repairs. Delete first would leave lines nobody can remove.
        await viaUsage(() => partUsage.removeFromProjects(id, clock.now()));
      } else {
        const { total } = await viaUsage(() => partUsage.listProjects(id, 1));
        if (total > 0) {
          // Fixed text: no project names or counts in an error (the usage endpoint has them).
          throw new AppError('conflict', 'The part is used by one or more projects.', {
            issues: [{ path: 'projects', message: 'Remove the part from the projects first.' }],
          });
        }
      }

      // Missing and already deleted look the same: nothing live matched.
      if ((await repository.softDelete(id, clock.now())) === null) throw notFound();
    },

    async usage(id) {
      if ((await repository.findLiveById(id)) === null) throw notFound();
      return viaUsage(() => partUsage.listProjects(id, USAGE_LIST_LIMIT));
    },
  };
}
