// Use cases for filaments (CU05). Knows nothing about HTTP or MongoDB: it talks to a repository
// interface and to the injected clock.
import { AppError } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import {
  filamentRuleIssues,
  mergeFilament,
  type Filament,
  type FilamentFields,
  type FilamentListQuery,
  type FilamentPage,
  type FilamentPatch,
} from './filaments.domain.js';

/**
 * Persistence port. Every method returns plain objects. Methods that write return `null` when
 * the conditional update matched nothing; the service decides what that means.
 */
export interface FilamentRepository {
  create(fields: FilamentFields, now: Date): Promise<Filament>;
  /** A filament that exists and is not deleted. */
  findLiveById(id: string): Promise<Filament | null>;
  list(query: FilamentListQuery): Promise<FilamentPage>;
  /** One atomic write guarded by `{ id, version, not deleted }`; bumps the version. */
  update(id: string, version: number, patch: FilamentPatch, now: Date): Promise<Filament | null>;
  /** One atomic write guarded by `{ id, not deleted }`; bumps the version. */
  softDelete(id: string, now: Date): Promise<Filament | null>;
  /**
   * One atomic decrement guarded by `{ id, not deleted, availableGrams >= grams }`; bumps the
   * version. `null` when it matched nothing (missing, deleted, or not enough material).
   */
  consume(id: string, grams: number, now: Date): Promise<Filament | null>;
}

export interface NewFilament {
  readonly brand: string;
  readonly material: FilamentFields['material'];
  readonly colorName: string;
  readonly initialGrams: number;
  readonly availableGrams?: number | undefined;
  readonly purchaseCostMinor: number;
  readonly purchaseDate: Date;
}

export interface FilamentEdit extends FilamentPatch {
  readonly version: number;
}

export interface FilamentsService {
  create(input: NewFilament): Promise<Filament>;
  get(id: string): Promise<Filament>;
  list(query: FilamentListQuery): Promise<FilamentPage>;
  update(id: string, edit: FilamentEdit): Promise<Filament>;
  remove(id: string): Promise<void>;
  consume(id: string, grams: number): Promise<Filament>;
}

const notFound = (): AppError => new AppError('not_found', 'The filament does not exist.');

function staleVersion(): AppError {
  return new AppError('conflict', 'The filament was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });
}

function notEnoughMaterial(): AppError {
  return new AppError('conflict', 'Not enough material available.', {
    issues: [{ path: 'grams', message: 'Not enough material available.' }],
  });
}

function assertRules(fields: FilamentFields, now: Date, checkDate: boolean): void {
  const issues = filamentRuleIssues(fields, now, checkDate);
  if (issues.length === 0) return;
  throw new AppError('validation_failed', 'The request is not valid.', { issues });
}

export function createFilamentsService(deps: {
  repository: FilamentRepository;
  clock: Clock;
}): FilamentsService {
  const { repository, clock } = deps;

  return {
    async create(input) {
      const fields: FilamentFields = {
        brand: input.brand,
        material: input.material,
        colorName: input.colorName,
        initialGrams: input.initialGrams,
        availableGrams: input.availableGrams ?? input.initialGrams,
        purchaseCostMinor: input.purchaseCostMinor,
        purchaseDate: input.purchaseDate,
      };
      const now = clock.now();
      assertRules(fields, now, true);
      return repository.create(fields, now);
    },

    async get(id) {
      const filament = await repository.findLiveById(id);
      if (filament === null) throw notFound();
      return filament;
    },

    list(query) {
      return repository.list(query);
    },

    async update(id, edit) {
      const { version, ...patch } = edit;
      const current = await repository.findLiveById(id);
      if (current === null) throw notFound();
      if (current.version !== version) throw staleVersion();
      const now = clock.now();
      assertRules(mergeFilament(current, patch), now, patch.purchaseDate !== undefined);

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

    async consume(id, grams) {
      const consumed = await repository.consume(id, grams, clock.now());
      if (consumed !== null) return consumed;

      // The atomic decrement matched nothing: look again only to say why. The read never decides
      // whether to write, so a race cannot overdraw the spool.
      if ((await repository.findLiveById(id)) === null) throw notFound();
      throw notEnoughMaterial();
    },
  };
}
