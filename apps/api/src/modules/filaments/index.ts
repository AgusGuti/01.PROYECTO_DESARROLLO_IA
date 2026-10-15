// Public surface of the filaments module (standard §1.2).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import { createFilamentsController } from './filaments.controller.js';
import { createMongoFilamentRepository } from './filaments.repository.js';
import { createFilamentsRouter } from './filaments.routes.js';
import { createFilamentsService, type FilamentRepository } from './filaments.service.js';

export { registerFilamentsPaths } from './filaments.openapi.js';

export function createFilamentsModule(deps: {
  clock: Clock;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: FilamentRepository;
}): { router: Router } {
  const service = createFilamentsService({
    repository: deps.repository ?? createMongoFilamentRepository(),
    clock: deps.clock,
  });
  return { router: createFilamentsRouter(createFilamentsController(service)) };
}
