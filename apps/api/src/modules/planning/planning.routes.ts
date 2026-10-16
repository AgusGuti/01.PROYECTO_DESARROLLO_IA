import { Router } from 'express';
import type { PlanningController } from './planning.controller.js';

export function createPlanningRouter(controller: PlanningController): Router {
  const router = Router();
  router.get('/settings', controller.getSettings);
  router.put('/settings', controller.saveSettings);
  return router;
}
