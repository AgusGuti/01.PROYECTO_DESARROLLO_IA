// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toProjectDto, toProjectListDto } from './projects.mapper.js';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from './projects.schemas.js';
import type { ProjectsService } from './projects.service.js';

export interface ProjectsController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
}

export function createProjectsController(service: ProjectsService): ProjectsController {
  return {
    create: async (req, res) => {
      const input = parseInput(createProjectSchema, req.body);
      const detail = await service.create(input);
      res.status(201).location(`/api/v1/projects/${detail.project.id}`).json(toProjectDto(detail));
    },

    list: async (req, res) => {
      const query = parseInput(listProjectsQuerySchema, req.query);
      const result = await service.list(query);
      res.json(toProjectListDto(result, query));
    },

    get: async (req, res) => {
      const { id } = parseInput(projectIdParamsSchema, req.params);
      res.json(toProjectDto(await service.get(id)));
    },

    update: async (req, res) => {
      const { id } = parseInput(projectIdParamsSchema, req.params);
      const edit = parseInput(updateProjectSchema, req.body);
      res.json(toProjectDto(await service.update(id, edit)));
    },

    remove: async (req, res) => {
      const { id } = parseInput(projectIdParamsSchema, req.params);
      await service.remove(id);
      res.status(204).end();
    },
  };
}
