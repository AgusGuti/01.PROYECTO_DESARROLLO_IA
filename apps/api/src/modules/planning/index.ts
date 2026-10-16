// Public surface of the planning module (standard §1.2): the planning settings (ADR 0027).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import { createPlanningController } from './planning.controller.js';
import { DEFAULT_PLANNING_SETTINGS } from './planning.domain.js';
import { createMongoPlanningSettingsRepository } from './planning.repository.js';
import { createPlanningRouter } from './planning.routes.js';
import { createPlanningService, type PlanningSettingsRepository } from './planning.service.js';

export { registerPlanningPaths } from './planning.openapi.js';

/**
 * Builds the simulations module's settings port (ADR 0017, 0027): the batch saving in force, or
 * the default (0) when never saved. Never writes.
 */
export function createPlanningSettingsReader(
  repository: Pick<PlanningSettingsRepository, 'find'> = createMongoPlanningSettingsRepository(),
): () => Promise<{ batchSavingBasisPoints: number }> {
  return async () => {
    const settings = (await repository.find()) ?? DEFAULT_PLANNING_SETTINGS;
    return { batchSavingBasisPoints: settings.batchSavingBasisPoints };
  };
}

// There is no `ensureIndexes`: the planningSettings collection has no index beyond `_id` (ADR 0027).

export function createPlanningModule(deps: {
  clock: Clock;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: PlanningSettingsRepository;
}): { router: Router } {
  const service = createPlanningService({
    repository: deps.repository ?? createMongoPlanningSettingsRepository(),
    clock: deps.clock,
  });
  return { router: createPlanningRouter(createPlanningController(service)) };
}
