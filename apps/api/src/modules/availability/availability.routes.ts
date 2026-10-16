import { Router } from 'express';
import type { AvailabilityController } from './availability.controller.js';

export function createAvailabilityRouter(controller: AvailabilityController): Router {
  const router = Router();
  router.get('/schedule', controller.getSchedule);
  router.put('/schedule', controller.saveSchedule);
  return router;
}
