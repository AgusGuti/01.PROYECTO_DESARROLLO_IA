// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toChatDto, toGcodeImportDto } from './chat.mapper.js';
import { chatRequestSchema, gcodeImportRequestSchema } from './chat.schemas.js';
import type { ChatService, GcodeImportService } from './chat.service.js';

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

export interface GcodeImportController {
  importGcodes: RequestHandler;
}

export function createGcodeImportController(service: GcodeImportService): GcodeImportController {
  return {
    importGcodes: async (req, res) => {
      const input = parseInput(gcodeImportRequestSchema, req.body);
      res.json(toGcodeImportDto(await service.importGcodes(input)));
    },
  };
}
