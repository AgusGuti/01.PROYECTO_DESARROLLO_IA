// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toSimulationDto } from './simulations.mapper.js';
import { simulationRequestSchema } from './simulations.schemas.js';
import type { SimulationsService } from './simulations.service.js';

export interface SimulationsController {
  simulate: RequestHandler;
}

export function createSimulationsController(service: SimulationsService): SimulationsController {
  return {
    simulate: async (req, res) => {
      const input = parseInput(simulationRequestSchema, req.body);
      res.json(toSimulationDto(await service.simulate(input)));
    },
  };
}
