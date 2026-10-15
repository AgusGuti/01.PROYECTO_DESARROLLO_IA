import { Router } from 'express';
import type { ProjectsController } from './projects.controller.js';

export function createProjectsRouter(controller: ProjectsController): Router {
  const router = Router();
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}
