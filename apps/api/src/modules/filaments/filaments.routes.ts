import { Router } from 'express';
import type { FilamentsController } from './filaments.controller.js';

export function createFilamentsRouter(controller: FilamentsController): Router {
  const router = Router();
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.post('/:id/consume', controller.consume);
  return router;
}
