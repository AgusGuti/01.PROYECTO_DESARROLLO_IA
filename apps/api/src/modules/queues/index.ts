// Public surface of the queues module (standard §1.2).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import type { Goal, Mode } from './queues.domain.js';
import { createQueuesController } from './queues.controller.js';
import { createMongoQueueRepository } from './queues.repository.js';
import { createQueuesRouter } from './queues.routes.js';
import {
  createQueuesService,
  type PartLookup,
  type PrinterLookup,
  type ProjectReader,
  type QueueRepository,
} from './queues.service.js';

export { registerQueuesPaths } from './queues.openapi.js';
export type { PartLookup, PrinterLookup, ProjectReader } from './queues.service.js';

/**
 * Builds the simulations module's queue port (ADR 0026): the stored queue of a project, or null.
 * Never writes.
 */
export function createSimulationQueueReader(
  repository: Pick<QueueRepository, 'findById'> = createMongoQueueRepository(),
): (projectId: string) => Promise<{
  goal: Goal;
  mode: Mode;
  printerIds: string[];
  lines: { partId: string; quantity: number; completed: number }[];
} | null> {
  return async (projectId) => {
    const queue = await repository.findById(projectId);
    if (queue === null) return null;
    return {
      goal: queue.goal,
      mode: queue.mode,
      printerIds: [...queue.printerIds],
      lines: queue.lines.map(({ partId, quantity, completed }) => ({
        partId,
        quantity,
        completed,
      })),
    };
  };
}

/**
 * Builds the printers module's usage check (ADR 0006, 0032): a printer is in use when a queue
 * selects it and still has pending work. A failure rejects, so the printer is never deleted
 * when the answer is unknown.
 */
export function createPrinterUsageCheck(
  repository: Pick<QueueRepository, 'hasPendingWorkFor'> = createMongoQueueRepository(),
): (printerId: string) => Promise<boolean> {
  return async (printerId) => await repository.hasPendingWorkFor(printerId);
}

/** Creates the queues indexes (the printer id lookup, ADR 0032). Run by `npm run db:indexes`. */
export function ensureQueuesIndexes(): Promise<void> {
  return createMongoQueueRepository().ensureIndexes();
}

export function createQueuesModule(deps: {
  clock: Clock;
  /** Read ports owned by this module, built in app.ts from each provider (ADR 0017). */
  projectReader: ProjectReader;
  partLookup: PartLookup;
  printerLookup: PrinterLookup;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: QueueRepository;
}): { router: Router } {
  const service = createQueuesService({
    repository: deps.repository ?? createMongoQueueRepository(),
    projectReader: deps.projectReader,
    partLookup: deps.partLookup,
    printerLookup: deps.printerLookup,
    clock: deps.clock,
  });
  return { router: createQueuesRouter(createQueuesController(service)) };
}
