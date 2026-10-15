// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toPartDto, toPartListDto } from './parts.mapper.js';
import {
  createPartSchema,
  listPartsQuerySchema,
  partIdParamsSchema,
  updatePartSchema,
} from './parts.schemas.js';
import type { PartsService } from './parts.service.js';

export interface PartsController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
}

export function createPartsController(service: PartsService): PartsController {
  return {
    create: async (req, res) => {
      const input = parseInput(createPartSchema, req.body);
      const part = await service.create(input);
      res.status(201).location(`/api/v1/parts/${part.id}`).json(toPartDto(part));
    },

    list: async (req, res) => {
      const query = parseInput(listPartsQuerySchema, req.query);
      const result = await service.list(query);
      res.json(toPartListDto(result, query));
    },

    get: async (req, res) => {
      const { id } = parseInput(partIdParamsSchema, req.params);
      res.json(toPartDto(await service.get(id)));
    },

    update: async (req, res) => {
      const { id } = parseInput(partIdParamsSchema, req.params);
      const edit = parseInput(updatePartSchema, req.body);
      res.json(toPartDto(await service.update(id, edit)));
    },

    remove: async (req, res) => {
      const { id } = parseInput(partIdParamsSchema, req.params);
      await service.remove(id);
      res.status(204).end();
    },
  };
}
