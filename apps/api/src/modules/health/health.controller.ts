// Controller: translates HTTP to a service call and the result back to HTTP. No rules here.
import type { RequestHandler } from 'express';
import { toLivenessDto, toReadinessDto } from './health.mapper.js';
import type { HealthService } from './health.service.js';

export interface HealthController {
  live: RequestHandler;
  ready: RequestHandler;
}

export function createHealthController(service: HealthService): HealthController {
  return {
    live: (_req, res) => {
      res.json(toLivenessDto(service.liveness()));
    },

    // Express 5 forwards a rejected promise to the error handler, so no try/catch is needed.
    ready: async (_req, res) => {
      const readiness = await service.readiness();
      res.status(readiness.status === 'ready' ? 200 : 503).json(toReadinessDto(readiness));
    },
  };
}
