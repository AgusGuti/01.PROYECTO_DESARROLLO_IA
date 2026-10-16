// Public surface of the printers module (standard §1.2).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import { createPrintersController } from './printers.controller.js';
import { createMongoPrinterRepository } from './printers.repository.js';
import { createPrintersRouter } from './printers.routes.js';
import {
  createPrintersService,
  type PrinterRepository,
  type PrinterUsageCheck,
} from './printers.service.js';

export { registerPrintersPaths } from './printers.openapi.js';
export type { PrinterUsageCheck } from './printers.service.js';

/**
 * Creates the printers indexes, among them the unique name index that name uniqueness depends
 * on. `autoIndex` is off in production, so this is run deliberately with `npm run db:indexes`
 * (data rules: schema changes are never applied automatically at startup). Safe to repeat.
 */
export function ensurePrintersIndexes(): Promise<void> {
  return createMongoPrinterRepository().ensureIndexes();
}

/**
 * Fails when the unique name index is missing. The server calls it at startup in production:
 * without the index two printers could share a name, so it refuses to start instead.
 */
export async function assertPrintersIndexes(): Promise<void> {
  if (!(await createMongoPrinterRepository().hasUniqueNameIndex())) {
    throw new Error('The unique index on printers.name is missing. Run: npm run db:indexes');
  }
}

/**
 * Builds the costs module's `PrinterReader` (ADR 0017). A printer pending removal (archived) is
 * still found, because it exists until it is deleted; a deleted one is not.
 */
export function createPrinterCostReader(
  repository: Pick<PrinterRepository, 'findLiveById'> = createMongoPrinterRepository(),
): (id: string) => Promise<{ id: string; powerWatts: number | null } | null> {
  return async (id) => {
    const printer = await repository.findLiveById(id);
    return printer === null ? null : { id: printer.id, powerWatts: printer.powerWatts };
  };
}

/**
 * Builds the queues module's printer port (ADR 0025): which of these ids are live and NOT
 * archived. An archived printer is pending removal, so it cannot be selected for a new queue.
 * One lookup per id (a queue selects at most 10).
 */
export function createSelectablePrinterLookup(
  repository: Pick<PrinterRepository, 'findLiveById'> = createMongoPrinterRepository(),
): (ids: string[]) => Promise<ReadonlySet<string>> {
  return async (ids) => {
    const found = await Promise.all(ids.map((id) => repository.findLiveById(id)));
    return new Set(found.flatMap((printer) => (printer?.archivedAt === null ? [printer.id] : [])));
  };
}

/**
 * Builds the simulations module's printer port (ADR 0026): the name of each id that is live and
 * NOT archived. An id missing from the answer is unknown, deleted or archived.
 */
export function createSimulationPrinterLookup(
  repository: Pick<PrinterRepository, 'findLiveById'> = createMongoPrinterRepository(),
): (ids: string[]) => Promise<ReadonlyMap<string, { name: string }>> {
  return async (ids) => {
    const found = await Promise.all(ids.map((id) => repository.findLiveById(id)));
    return new Map(
      found.flatMap((printer) =>
        printer?.archivedAt === null ? [[printer.id, { name: printer.name }] as const] : [],
      ),
    );
  };
}

// The assignments check (and so the archived -> deleted step, ADR 0006) is a follow-up of CU07:
// the queues module stores printerIds but nothing answers this yet, so only the idle-delete
// path is reachable.
const noAssignmentsYet: PrinterUsageCheck = () => Promise.resolve(false);

function chooseRepository(injected: PrinterRepository | undefined): {
  repository: PrinterRepository;
  ensureIndexes: () => Promise<void>;
} {
  if (injected !== undefined) {
    return { repository: injected, ensureIndexes: () => Promise.resolve() };
  }
  const mongo = createMongoPrinterRepository();
  return { repository: mongo, ensureIndexes: () => mongo.ensureIndexes() };
}

export function createPrintersModule(deps: {
  clock: Clock;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: PrinterRepository;
  hasAssignments?: PrinterUsageCheck;
}): {
  router: Router;
  /** Creates the MongoDB indexes. A no-op when a fake repository was injected. */
  ensureIndexes: () => Promise<void>;
} {
  const { repository, ensureIndexes } = chooseRepository(deps.repository);
  const service = createPrintersService({
    repository,
    clock: deps.clock,
    hasAssignments: deps.hasAssignments ?? noAssignmentsYet,
  });
  return { router: createPrintersRouter(createPrintersController(service)), ensureIndexes };
}
