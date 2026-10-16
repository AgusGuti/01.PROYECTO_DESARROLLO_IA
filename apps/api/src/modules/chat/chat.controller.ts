// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toChatDto } from './chat.mapper.js';
import { chatRequestSchema } from './chat.schemas.js';
import type { ChatService } from './chat.service.js';

export interface ChatController {
  ask: RequestHandler;
}

export function createChatController(service: ChatService): ChatController {
  return {
    ask: async (req, res) => {
      const { message } = parseInput(chatRequestSchema, req.body);
      res.json(toChatDto(await service.ask(message)));
    },
  };
}
