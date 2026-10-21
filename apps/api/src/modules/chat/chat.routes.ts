import { Router } from 'express';
import type { ChatController, GcodeImportController } from './chat.controller.js';

export function createChatRouter(controller: ChatController): Router {
  const router = Router();
  router.post('/', controller.ask);
  return router;
}

export function createGcodeImportRouter(controller: GcodeImportController): Router {
  const router = Router();
  router.post('/', controller.importGcodes);
  return router;
}
