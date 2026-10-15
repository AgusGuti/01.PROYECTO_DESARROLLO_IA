// Public surface of the costs module (standard §1.2).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import { createCostsController } from './costs.controller.js';
import { createMongoCostSettingsRepository } from './costs.repository.js';
import { createCostsRouter } from './costs.routes.js';
import {
  createCostsService,
  type CostSettingsRepository,
  type FilamentReader,
  type PartReader,
  type PrinterReader,
} from './costs.service.js';

export { registerCostsPaths } from './costs.openapi.js';
export type { FilamentReader, PartReader, PrinterReader } from './costs.service.js';

// There is no `ensureIndexes`: the settings collection has no index beyond `_id` (ADR 0021).

export function createCostsModule(deps: {
  clock: Clock;
  /** Read ports owned by this module, built in app.ts from each provider (ADR 0017). */
  partReader: PartReader;
  filamentReader: FilamentReader;
  printerReader: PrinterReader;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: CostSettingsRepository;
}): { router: Router } {
  const service = createCostsService({
    repository: deps.repository ?? createMongoCostSettingsRepository(),
    partReader: deps.partReader,
    filamentReader: deps.filamentReader,
    printerReader: deps.printerReader,
    clock: deps.clock,
  });
  return { router: createCostsRouter(createCostsController(service)) };
}
