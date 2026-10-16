// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toQueueDto } from './queues.mapper.js';
import {
  createQueueSchema,
  deleteQueueQuerySchema,
  queueParamsSchema,
  updateQueueSchema,
} from './queues.schemas.js';
import type { QueuesService } from './queues.service.js';

export interface QueuesController {
  create: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
}

export function createQueuesController(service: QueuesService): QueuesController {
  return {
    create: async (req, res) => {
      const input = parseInput(createQueueSchema, req.body);
      const detail = await service.create(input);
      res.status(201).location(`/api/v1/queues/${detail.queue.id}`).json(toQueueDto(detail));
    },

    get: async (req, res) => {
      const { projectId } = parseInput(queueParamsSchema, req.params);
      res.json(toQueueDto(await service.get(projectId)));
    },

    update: async (req, res) => {
      const { projectId } = parseInput(queueParamsSchema, req.params);
      const edit = parseInput(updateQueueSchema, req.body);
      res.json(toQueueDto(await service.update(projectId, edit)));
    },

    remove: async (req, res) => {
      const { projectId } = parseInput(queueParamsSchema, req.params);
      const { version } = parseInput(deleteQueueQuerySchema, req.query);
      await service.remove(projectId, version);
      res.status(204).end();
    },
  };
}
