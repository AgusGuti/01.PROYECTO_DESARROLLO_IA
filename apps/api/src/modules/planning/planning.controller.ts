// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toPlanningSettingsDto } from './planning.mapper.js';
import { updatePlanningSettingsSchema } from './planning.schemas.js';
import type { PlanningService } from './planning.service.js';

export interface PlanningController {
  getSettings: RequestHandler;
  saveSettings: RequestHandler;
}

export function createPlanningController(service: PlanningService): PlanningController {
  return {
    getSettings: async (_req, res) => {
      res.json(toPlanningSettingsDto(await service.getSettings()));
    },

    saveSettings: async (req, res) => {
      const edit = parseInput(updatePlanningSettingsSchema, req.body);
      res.json(toPlanningSettingsDto(await service.saveSettings(edit)));
    },
  };
}
