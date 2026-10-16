import { Router } from 'express';
import type { ChatController } from './chat.controller.js';

export function createChatRouter(controller: ChatController): Router {
  const router = Router();
  router.post('/', controller.ask);
  return router;
}
