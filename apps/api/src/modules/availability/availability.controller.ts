// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toScheduleDto } from './availability.mapper.js';
import { updateScheduleSchema } from './availability.schemas.js';
import type { AvailabilityService } from './availability.service.js';

export interface AvailabilityController {
  getSchedule: RequestHandler;
  saveSchedule: RequestHandler;
}

export function createAvailabilityController(service: AvailabilityService): AvailabilityController {
  return {
    getSchedule: async (_req, res) => {
      res.json(toScheduleDto(await service.getSchedule()));
    },

    saveSchedule: async (req, res) => {
      const edit = parseInput(updateScheduleSchema, req.body);
      res.json(toScheduleDto(await service.saveSchedule(edit)));
    },
  };
}
