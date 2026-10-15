import { Router } from 'express';
import type { GcodeController } from './gcode.controller.js';

export function createGcodeRouter(controller: GcodeController): Router {
  const router = Router();
  router.post('/', controller.analyze);
  return router;
}
