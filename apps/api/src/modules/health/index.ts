// Public surface of the health module. Other code imports from here only, never from the
// files next to it (standard §1.2: no importing another module's internals).
import type { Router } from 'express';
import { createHealthController } from './health.controller.js';
import { createHealthRouter } from './health.routes.js';
import { createHealthService, type Clock, type DependencyProbe } from './health.service.js';

export { registerHealthPaths } from './health.openapi.js';
export type { Clock, DependencyProbe } from './health.service.js';

export function createHealthModule(deps: { database: DependencyProbe; clock: Clock }): {
  router: Router;
} {
  const service = createHealthService(deps);
  const controller = createHealthController(service);
  return { router: createHealthRouter(controller) };
}
