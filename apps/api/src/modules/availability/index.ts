// Public surface of the availability module (standard §1.2). The optimiser reads the schedule
// rules through the domain functions exported here.
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import { createAvailabilityController } from './availability.controller.js';
import { createMongoScheduleRepository } from './availability.repository.js';
import { DEFAULT_SCHEDULE, type ScheduleRules } from './availability.domain.js';
import { createAvailabilityRouter } from './availability.routes.js';
import { createAvailabilityService, type ScheduleRepository } from './availability.service.js';

export { registerAvailabilityPaths } from './availability.openapi.js';
export {
  interventionRangesFor,
  isInterventionPossible,
  type MinuteRange,
  type ScheduleRules,
} from './availability.domain.js';

/**
 * Builds the simulations module's schedule port (ADR 0026): the rules in force, or the defaults
 * (version 0) when never saved. Never writes.
 */
export function createScheduleReader(
  repository: Pick<ScheduleRepository, 'find'> = createMongoScheduleRepository(),
): () => Promise<ScheduleRules & { version: number }> {
  return async () => {
    const schedule = (await repository.find()) ?? DEFAULT_SCHEDULE;
    return { weekly: schedule.weekly, exceptions: schedule.exceptions, version: schedule.version };
  };
}

// There is no `ensureIndexes`: the availability collection has no index beyond `_id` (ADR 0024).

export function createAvailabilityModule(deps: {
  clock: Clock;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: ScheduleRepository;
}): { router: Router } {
  const service = createAvailabilityService({
    repository: deps.repository ?? createMongoScheduleRepository(),
    clock: deps.clock,
  });
  return { router: createAvailabilityRouter(createAvailabilityController(service)) };
}
