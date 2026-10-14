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

// CU07 (the print queue) will implement this check and finish the archived -> deleted step
// (ADR 0006). Until then no printer has assignments, so only the idle-delete path is reachable.
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
