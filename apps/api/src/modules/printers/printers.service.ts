// Use cases for printers (CU06). Knows nothing about HTTP or MongoDB: it talks to a repository
// interface and to two small ports (clock, usage check) that are passed in from outside.
import { AppError } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import {
  isArchived,
  materialsNeedingHardenedNozzle,
  mergePrinter,
  type Printer,
  type PrinterFields,
  type PrinterListQuery,
  type PrinterPage,
  type PrinterPatch,
  type PrinterStatus,
} from './printers.domain.js';

/**
 * Does this printer still have work assigned? Provided by the queues module (ADR 0032)
 * and wired in app.ts. A rejection means "unknown": the service then fails closed.
 */
export type PrinterUsageCheck = (printerId: string) => Promise<boolean>;

/**
 * Persistence port. Every method returns plain objects. Methods that write return `null` when
 * the conditional update matched nothing; the service decides what that means.
 */
export interface PrinterRepository {
  /**
   * @throws AppError `conflict` when the name is taken: issue path `name` for a live printer,
   * `restoreIfDeleted` for a deleted one (a deleted printer keeps its name reserved).
   */
  create(fields: PrinterFields, now: Date): Promise<Printer>;
  /**
   * One atomic write that revives the deleted printer holding `fields.name` (same collation as the
   * index) with the submitted data. `null` when no deleted printer has that name.
   */
  restore(fields: PrinterFields, now: Date): Promise<Printer | null>;
  /** Clears `archivedAt` on a live, archived printer. `null` when it matched nothing. */
  unarchive(id: string, now: Date): Promise<Printer | null>;
  /** A printer that exists and is not deleted (archived printers are included). */
  findLiveById(id: string): Promise<Printer | null>;
  list(query: PrinterListQuery): Promise<PrinterPage>;
  /**
   * One atomic write guarded by `{ id, version, not deleted }`; bumps the version.
   * @throws AppError `conflict` (issue path `name`) on a duplicate name.
   */
  update(id: string, version: number, patch: PrinterPatch, now: Date): Promise<Printer | null>;
  /** Marks a live, not yet archived printer as pending deletion. */
  archive(id: string, now: Date): Promise<Printer | null>;
  /** Marks a live, not archived, not in-use printer as deleted. */
  softDelete(id: string, now: Date): Promise<Printer | null>;
}

export interface NewPrinter {
  readonly name: string;
  readonly buildVolume: PrinterFields['buildVolume'];
  readonly nozzle: PrinterFields['nozzle'];
  readonly compatibleMaterials: PrinterFields['compatibleMaterials'];
  readonly typicalSpeedMmS?: number | undefined;
  readonly powerWatts?: number | undefined;
  readonly status: PrinterStatus;
  /** The client agrees to reuse a deleted printer that holds the name. */
  readonly restoreIfDeleted?: boolean | undefined;
}

export interface CreateResult {
  readonly printer: Printer;
  /** True when a deleted printer was revived instead of a new one created. */
  readonly restored: boolean;
}

export interface PrinterEdit extends PrinterPatch {
  readonly version: number;
}

export interface PrintersService {
  create(input: NewPrinter): Promise<CreateResult>;
  /** Idempotent: an already live, not archived printer is returned as it is. */
  unarchive(id: string): Promise<Printer>;
  get(id: string): Promise<Printer>;
  list(query: PrinterListQuery): Promise<PrinterPage>;
  update(id: string, edit: PrinterEdit): Promise<Printer>;
  remove(id: string): Promise<void>;
}

const notFound = (): AppError => new AppError('not_found', 'The printer does not exist.');

function assertMaterialsFitNozzle(fields: PrinterFields): void {
  const offending = materialsNeedingHardenedNozzle(fields);
  if (offending.length === 0) return;
  throw new AppError('validation_failed', 'The request is not valid.', {
    issues: [
      {
        path: 'compatibleMaterials',
        message: `${offending.join(', ')} need a hardened_steel nozzle.`,
      },
    ],
  });
}

export function createPrintersService(deps: {
  repository: PrinterRepository;
  clock: Clock;
  hasAssignments: PrinterUsageCheck;
}): PrintersService {
  const { repository, clock, hasAssignments } = deps;

  /** Archive, then classify a miss: gone is 404, already archived is fine (idempotent). */
  async function archive(id: string): Promise<void> {
    const archived = await repository.archive(id, clock.now());
    if (archived !== null) return;
    if ((await repository.findLiveById(id)) === null) throw notFound();
  }

  return {
    async create(input) {
      const fields: PrinterFields = {
        name: input.name,
        buildVolume: input.buildVolume,
        nozzle: input.nozzle,
        compatibleMaterials: input.compatibleMaterials,
        typicalSpeedMmS: input.typicalSpeedMmS ?? null,
        powerWatts: input.powerWatts ?? null,
        status: input.status,
      };
      assertMaterialsFitNozzle(fields);
      const now = clock.now();
      if (input.restoreIfDeleted === true) {
        const restored = await repository.restore(fields, now);
        if (restored !== null) return { printer: restored, restored: true };
        // No deleted holder (or another request restored it first): fall through to a plain
        // create, whose unique index decides between 201 and a 409.
      }
      return { printer: await repository.create(fields, now), restored: false };
    },

    async unarchive(id) {
      const unarchived = await repository.unarchive(id, clock.now());
      if (unarchived !== null) return unarchived;
      // Nothing matched: missing or deleted is 404; live and not archived is already done.
      const current = await repository.findLiveById(id);
      if (current === null) throw notFound();
      return current;
    },

    async get(id) {
      const printer = await repository.findLiveById(id);
      if (printer === null) throw notFound();
      return printer;
    },

    list(query) {
      return repository.list(query);
    },

    async update(id, edit) {
      const { version, ...patch } = edit;
      const current = await repository.findLiveById(id);
      if (current === null) throw notFound();
      if (isArchived(current)) {
        throw new AppError('conflict', 'The printer is pending removal and cannot be edited.');
      }
      if (current.version !== version) throw staleVersion();
      assertMaterialsFitNozzle(mergePrinter(current, patch));

      const updated = await repository.update(id, version, patch, clock.now());
      if (updated !== null) return updated;

      // The conditional write matched nothing: look again only to say why.
      if ((await repository.findLiveById(id)) === null) throw notFound();
      throw staleVersion();
    },

    async remove(id) {
      const printer = await repository.findLiveById(id);
      if (printer === null) throw notFound();
      if (isArchived(printer)) return;

      // If the usage check fails we do not know whether the printer has work: fail closed.
      const busy = printer.status === 'in_use' || (await hasAssignments(id));
      if (busy) {
        await archive(id);
        return;
      }

      const deleted = await repository.softDelete(id, clock.now());
      if (deleted !== null) return;

      // The conditional delete missed: it was deleted, archived, or became in_use meanwhile.
      const now = await repository.findLiveById(id);
      if (now === null) throw notFound();
      if (isArchived(now)) return;
      await archive(id);
    },
  };
}

function staleVersion(): AppError {
  return new AppError('conflict', 'The printer was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });
}
