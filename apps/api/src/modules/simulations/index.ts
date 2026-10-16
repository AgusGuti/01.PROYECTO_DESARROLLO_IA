// Public surface of the simulations module (standard §1.2). It owns no collection.
import type { Router } from 'express';
import { createSimulationsController } from './simulations.controller.js';
import { createSimulationsRouter } from './simulations.routes.js';
import {
  createSimulationsService,
  type PartLookup,
  type PrinterLookup,
  type ProjectReader,
  type QueueReader,
  type PlanningReader,
  type ScheduleReader,
} from './simulations.service.js';

export { registerSimulationsPaths } from './simulations.openapi.js';
export type {
  PartLookup,
  PlanningReader,
  PrinterLookup,
  ProjectReader,
  QueueReader,
  ScheduleReader,
} from './simulations.service.js';

export function createSimulationsModule(deps: {
  /** Read ports owned by this module, built in app.ts from each provider (ADR 0017, 0026). */
  queueReader: QueueReader;
  projectReader: ProjectReader;
  partLookup: PartLookup;
  printerLookup: PrinterLookup;
  scheduleReader: ScheduleReader;
  planningReader: PlanningReader;
}): { router: Router } {
  const service = createSimulationsService(deps);
  return { router: createSimulationsRouter(createSimulationsController(service)) };
}
