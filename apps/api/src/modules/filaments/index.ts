// Public surface of the filaments module (standard §1.2).
import type { Router } from 'express';
import type { Clock } from '../health/index.js';
import type { Material } from '../../shared/catalog/materials.js';
import { createFilamentsController } from './filaments.controller.js';
import { createMongoFilamentRepository } from './filaments.repository.js';
import { createFilamentsRouter } from './filaments.routes.js';
import { createFilamentsService, type FilamentRepository } from './filaments.service.js';

export { registerFilamentsPaths } from './filaments.openapi.js';

/**
 * Builds the costs module's `FilamentReader` (ADR 0017): one live spool with the fields a cost
 * needs. Its shape is the consumer's port, matched structurally.
 */
export function createFilamentCostReader(
  repository: Pick<FilamentRepository, 'findLiveById'> = createMongoFilamentRepository(),
): (id: string) => Promise<{
  id: string;
  material: Material;
  initialGrams: number;
  availableGrams: number;
  purchaseCostMinor: number;
} | null> {
  return async (id) => {
    const filament = await repository.findLiveById(id);
    if (filament === null) return null;
    return {
      id: filament.id,
      material: filament.material,
      initialGrams: filament.initialGrams,
      availableGrams: filament.availableGrams,
      purchaseCostMinor: filament.purchaseCostMinor,
    };
  };
}

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
