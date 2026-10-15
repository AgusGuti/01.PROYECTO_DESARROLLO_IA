import { Router } from 'express';
import type { PartsController } from './parts.controller.js';

export function createPartsRouter(controller: PartsController): Router {
  const router = Router();
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
