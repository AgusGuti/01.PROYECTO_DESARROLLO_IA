// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toPrinterDto, toPrinterListDto } from './printers.mapper.js';
import {
  createPrinterSchema,
  listPrintersQuerySchema,
  printerIdParamsSchema,
  updatePrinterSchema,
} from './printers.schemas.js';
import type { PrintersService } from './printers.service.js';

export interface PrintersController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  unarchive: RequestHandler;
}

export function createPrintersController(service: PrintersService): PrintersController {
  return {
    create: async (req, res) => {
      const input = parseInput(createPrinterSchema, req.body);
      const { printer, restored } = await service.create(input);
      // 200 when a deleted printer was revived, 201 when a new one was created.
      res
        .status(restored ? 200 : 201)
        .location(`/api/v1/printers/${printer.id}`)
        .json(toPrinterDto(printer));
    },

    unarchive: async (req, res) => {
      const { id } = parseInput(printerIdParamsSchema, req.params);
      res.json(toPrinterDto(await service.unarchive(id)));
    },

    list: async (req, res) => {
      const query = parseInput(listPrintersQuerySchema, req.query);
      const result = await service.list(query);
      res.json(toPrinterListDto(result, query));
    },

    get: async (req, res) => {
      const { id } = parseInput(printerIdParamsSchema, req.params);
      res.json(toPrinterDto(await service.get(id)));
    },

    update: async (req, res) => {
      const { id } = parseInput(printerIdParamsSchema, req.params);
      const edit = parseInput(updatePrinterSchema, req.body);
      res.json(toPrinterDto(await service.update(id, edit)));
    },

    remove: async (req, res) => {
      const { id } = parseInput(printerIdParamsSchema, req.params);
      await service.remove(id);
      res.status(204).end();
    },
  };
}
