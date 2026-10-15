// Public surface of the parts module (standard §1.2).
import type { Router } from 'express';
import type { Material as PartMaterial } from '../../shared/catalog/materials.js';
import type { Clock } from '../health/index.js';
import { createPartsController } from './parts.controller.js';
import { createMongoPartRepository } from './parts.repository.js';
import { createPartsRouter } from './parts.routes.js';
import { createPartsService, type PartRepository, type PartUsage } from './parts.service.js';

export { registerPartsPaths } from './parts.openapi.js';
export type { PartRepository, PartUsage } from './parts.service.js';
// The real repository, for integration tests that wrap it to inject a failure.
export { createMongoPartRepository } from './parts.repository.js';

/**
 * Builds the "which of these parts are live?" function the projects module needs (ADR 0017).
 * One query for all ids. Its shape is the consumer's `PartLookup` port, matched structurally.
 */
export function createPartLookup(
  repository: Pick<PartRepository, 'findLiveByIds'> = createMongoPartRepository(),
): (ids: string[]) => Promise<ReadonlyMap<string, { name: string; material: PartMaterial }>> {
  return async (ids) => {
    const found = await repository.findLiveByIds(ids);
    return new Map(found.map((part) => [part.id, { name: part.name, material: part.material }]));
  };
}

export function createPartsModule(deps: {
  clock: Clock;
  /** Tests inject a fake; production uses MongoDB. */
  repository?: PartRepository;
  /**
   * The projects that use a part (ADR 0017, 0018). Required on purpose: a default of "nothing is
   * used" would let a delete skip the confirmation and leave projects pointing at a deleted part.
   */
  partUsage: PartUsage;
}): { router: Router } {
  const service = createPartsService({
    repository: deps.repository ?? createMongoPartRepository(),
    partUsage: deps.partUsage,
    clock: deps.clock,
  });
  return { router: createPartsRouter(createPartsController(service)) };
}
