// Public surface of the projects module (standard §1.2).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import { createProjectsController } from './projects.controller.js';
import { createMongoProjectRepository } from './projects.repository.js';
import { createProjectsRouter } from './projects.routes.js';
import {
  createProjectsService,
  type PartLookup,
  type ProjectRepository,
  type ProjectsService,
} from './projects.service.js';

export { registerProjectsPaths } from './projects.openapi.js';
export type { PartSummary } from './projects.domain.js';
export type { PartLookup } from './projects.service.js';

// There is no `ensureIndexes`: the module has no secondary index (ADR 0016).

/**
 * Builds the queues module's project port (ADR 0017, 0025): the lines of a live project, or null
 * when it is unknown or removed.
 */
export function createQueueProjectReader(
  repository: Pick<ProjectRepository, 'findLiveById'> = createMongoProjectRepository(),
): (id: string) => Promise<{ items: { partId: string; quantity: number }[] } | null> {
  return async (id) => {
    const project = await repository.findLiveById(id);
    return project === null
      ? null
      : { items: project.items.map(({ partId, quantity }) => ({ partId, quantity })) };
  };
}

export function createProjectsModule(deps: {
  clock: Clock;
  /** Which parts are live, with their name and material. Built in app.ts (ADR 0017). */
  partLookup: PartLookup;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: ProjectRepository;
}): {
  router: Router;
  /**
   * What the parts module needs to know about projects (its `PartUsage` port). Typed by the
   * consumer; app.ts is where the two meet.
   */
  partUsage: {
    listProjects: ProjectsService['usageOfPart'];
    removeFromProjects: ProjectsService['removePartFromProjects'];
  };
} {
  const service = createProjectsService({
    repository: deps.repository ?? createMongoProjectRepository(),
    partLookup: deps.partLookup,
    clock: deps.clock,
  });
  return {
    router: createProjectsRouter(createProjectsController(service)),
    partUsage: {
      listProjects: (partId, limit) => service.usageOfPart(partId, limit),
      removeFromProjects: (partId, now) => service.removePartFromProjects(partId, now),
    },
  };
}
