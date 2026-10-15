// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toFilamentDto, toFilamentListDto } from './filaments.mapper.js';
import {
  consumeFilamentSchema,
  createFilamentSchema,
  filamentIdParamsSchema,
  listFilamentsQuerySchema,
  updateFilamentSchema,
} from './filaments.schemas.js';
import type { FilamentsService } from './filaments.service.js';

export interface FilamentsController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  consume: RequestHandler;
}

export function createFilamentsController(service: FilamentsService): FilamentsController {
  return {
    create: async (req, res) => {
      const input = parseInput(createFilamentSchema, req.body);
      const filament = await service.create(input);
      res.status(201).location(`/api/v1/filaments/${filament.id}`).json(toFilamentDto(filament));
    },

    list: async (req, res) => {
      const query = parseInput(listFilamentsQuerySchema, req.query);
      const result = await service.list(query);
      res.json(toFilamentListDto(result, query));
    },

    get: async (req, res) => {
      const { id } = parseInput(filamentIdParamsSchema, req.params);
      res.json(toFilamentDto(await service.get(id)));
    },

    update: async (req, res) => {
      const { id } = parseInput(filamentIdParamsSchema, req.params);
      const edit = parseInput(updateFilamentSchema, req.body);
      res.json(toFilamentDto(await service.update(id, edit)));
    },

    remove: async (req, res) => {
      const { id } = parseInput(filamentIdParamsSchema, req.params);
      await service.remove(id);
      res.status(204).end();
    },

    consume: async (req, res) => {
      const { id } = parseInput(filamentIdParamsSchema, req.params);
      const { grams } = parseInput(consumeFilamentSchema, req.body);
      res.json(toFilamentDto(await service.consume(id, grams)));
    },
  };
}
