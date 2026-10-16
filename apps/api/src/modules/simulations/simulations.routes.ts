import { Router } from 'express';
import type { SimulationsController } from './simulations.controller.js';

export function createSimulationsRouter(controller: SimulationsController): Router {
  const router = Router();
  router.post('/', controller.simulate);
  return router;
}
