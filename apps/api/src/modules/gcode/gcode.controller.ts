// Controller: parse the request, call one service method, map the result. No rules here.
import type { RequestHandler } from 'express';
import { parseInput } from '../../shared/http/validate.js';
import { toGcodeAnalysisDto } from './gcode.mapper.js';
import { analyzeGcodeSchema } from './gcode.schemas.js';
import type { GcodeService } from './gcode.service.js';

export interface GcodeController {
  analyze: RequestHandler;
}

export function createGcodeController(service: GcodeService): GcodeController {
  return {
    analyze: (req, res) => {
      const input = parseInput(analyzeGcodeSchema, req.body);
      res.json(toGcodeAnalysisDto(service.analyze(input)));
    },
  };
}
