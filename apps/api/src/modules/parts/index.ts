// Public surface of the parts module (standard §1.2).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import { createPartsController } from './parts.controller.js';
import { createMongoPartRepository } from './parts.repository.js';
import { createPartsRouter } from './parts.routes.js';
import { createPartsService, type PartRepository } from './parts.service.js';

export { registerPartsPaths } from './parts.openapi.js';

export function createPartsModule(deps: {
  clock: Clock;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: PartRepository;
}): { router: Router } {
  const service = createPartsService({
    repository: deps.repository ?? createMongoPartRepository(),
    clock: deps.clock,
  });
  return { router: createPartsRouter(createPartsController(service)) };
}
