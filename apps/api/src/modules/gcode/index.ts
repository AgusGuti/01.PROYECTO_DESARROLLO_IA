// Public surface of the gcode module (standard §1.2). It has no repository and no clock.
import type { Router } from 'express';
import { createGcodeController } from './gcode.controller.js';
import { createGcodeRouter } from './gcode.routes.js';
import { createGcodeService } from './gcode.service.js';

export { registerGcodePaths } from './gcode.openapi.js';

export function createGcodeModule(): { router: Router } {
  return { router: createGcodeRouter(createGcodeController(createGcodeService())) };
}
