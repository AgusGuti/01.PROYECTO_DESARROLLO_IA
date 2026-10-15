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
}

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
  remove(id: string): Promise<void>;
}

const notFound = (): AppError => new AppError('not_found', 'The part does not exist.');

function staleVersion(): AppError {
  return new AppError('conflict', 'The part was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });
}

export function createPartsService(deps: {
  repository: PartRepository;
  clock: Clock;
}): PartsService {
  const { repository, clock } = deps;

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

    async remove(id) {
      // Missing and already deleted look the same: nothing live matched.
      if ((await repository.softDelete(id, clock.now())) === null) throw notFound();
    },
  };
}
