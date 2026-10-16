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

/**
 * Builds the costs module's `PartReader` (ADR 0017): one live part with the fields a cost needs.
 * Its shape is the consumer's port, matched structurally.
 */
export function createPartCostReader(
  repository: Pick<PartRepository, 'findLiveById'> = createMongoPartRepository(),
): (id: string) => Promise<{
  id: string;
  material: PartMaterial;
  estimatedWeightGrams: number;
  estimatedPrintSeconds: number;
} | null> {
  return async (id) => {
    const part = await repository.findLiveById(id);
    if (part === null) return null;
    return {
      id: part.id,
      material: part.material,
      estimatedWeightGrams: part.estimatedWeightGrams,
      estimatedPrintSeconds: part.estimatedPrintSeconds,
    };
  };
}

/**
 * Builds the queues module's part port (ADR 0017, 0025): name and print time of the live parts
 * among the ids, in one query. An id missing from the answer is unknown or deleted.
 */
export function createQueuePartLookup(
  repository: Pick<PartRepository, 'findLiveByIds'> = createMongoPartRepository(),
): (
  ids: string[],
) => Promise<ReadonlyMap<string, { name: string; estimatedPrintSeconds: number }>> {
  return async (ids) => {
    const found = await repository.findLiveByIds(ids);
    return new Map(
      found.map((part) => [
        part.id,
        { name: part.name, estimatedPrintSeconds: part.estimatedPrintSeconds },
      ]),
    );
  };
}

/**
 * Builds the simulations module's part port (ADR 0017, 0026, 0027): name, print time and size
 * (bounding box in mm) of the live parts among the ids, in one query.
 */
export function createSimulationPartLookup(
  repository: Pick<PartRepository, 'findLiveByIds'> = createMongoPartRepository(),
): (ids: string[]) => Promise<
  ReadonlyMap<
    string,
    {
      name: string;
      estimatedPrintSeconds: number;
      dimensionsMm: { x: number; y: number; z: number };
    }
  >
> {
  return async (ids) => {
    const found = await repository.findLiveByIds(ids);
    return new Map(
      found.map((part) => [
        part.id,
        {
          name: part.name,
          estimatedPrintSeconds: part.estimatedPrintSeconds,
          dimensionsMm: { x: part.dimensionsMm.x, y: part.dimensionsMm.y, z: part.dimensionsMm.z },
        },
      ]),
    );
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
