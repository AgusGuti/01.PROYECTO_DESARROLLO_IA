import { Router } from 'express';
import type { PrintersController } from './printers.controller.js';

export function createPrintersRouter(controller: PrintersController): Router {
  const router = Router();
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.post('/:id/unarchive', controller.unarchive);
  return router;
}
