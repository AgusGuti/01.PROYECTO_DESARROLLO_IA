// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toCostEstimateDto, toCostSettingsDto, toProjectCostEstimateDto } from './costs.mapper.js';
import {
  costEstimateRequestSchema,
  projectCostEstimateRequestSchema,
  updateCostSettingsSchema,
} from './costs.schemas.js';
import type { CostsService } from './costs.service.js';

export interface CostsController {
  estimate: RequestHandler;
  estimateProject: RequestHandler;
  getSettings: RequestHandler;
  saveSettings: RequestHandler;
}

export function createCostsController(service: CostsService): CostsController {
  return {
    estimate: async (req, res) => {
      const input = parseInput(costEstimateRequestSchema, req.body);
      res.json(toCostEstimateDto(await service.estimate(input)));
    },

    estimateProject: async (req, res) => {
      const { lines } = parseInput(projectCostEstimateRequestSchema, req.body);
      res.json(toProjectCostEstimateDto(await service.estimateProject(lines)));
    },

    getSettings: async (_req, res) => {
      res.json(toCostSettingsDto(await service.getSettings()));
    },

    saveSettings: async (req, res) => {
      const edit = parseInput(updateCostSettingsSchema, req.body);
      res.json(toCostSettingsDto(await service.saveSettings(edit)));
    },
  };
}
