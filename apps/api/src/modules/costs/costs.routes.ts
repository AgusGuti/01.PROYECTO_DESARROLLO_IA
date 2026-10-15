import { Router } from 'express';
import type { CostsController } from './costs.controller.js';

export function createCostsRouter(controller: CostsController): Router {
  const router = Router();
  router.post('/estimates', controller.estimate);
  router.post('/project-estimates', controller.estimateProject);
  router.get('/settings', controller.getSettings);
  router.put('/settings', controller.saveSettings);
  return router;
}
