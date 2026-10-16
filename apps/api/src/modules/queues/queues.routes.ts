import { Router } from 'express';
import type { QueuesController } from './queues.controller.js';

export function createQueuesRouter(controller: QueuesController): Router {
  const router = Router();
  router.post('/', controller.create);
  router.get('/:projectId', controller.get);
  router.patch('/:projectId', controller.update);
  router.delete('/:projectId', controller.remove);
  return router;
}
