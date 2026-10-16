// Use case: simulate the planning of a project (CU10). Stateless: it reads through five ports
// owned here (ADR 0017, 0026) and writes nothing. No HTTP, no MongoDB.
import { AppError, type FieldIssue } from '../../shared/errors/app-error.js';
import type { ScheduleRules } from '../availability/index.js';
import {
  deadlineMet,
  MAX_UNITS,
  minutesOf,
  parseLocalMinutes,
  simulateNaive,
  type Simulation,
  type SimulationLine,
  type SimulationWarningCode,
} from './simulations.domain.js';

export type Goal = 'deadline' | 'fastest' | 'minimal_idle';

/** The queue of a project as stored; null when the project has none. */
export type QueueReader = (projectId: string) => Promise<{
  goal: Goal;
  mode: 'single' | 'multi';
  printerIds: readonly string[];
  lines: readonly { partId: string; quantity: number; completed: number }[];
} | null>;
/** A live project's deadline as `YYYY-MM-DD` or null; a null result: unknown or removed. */
export type ProjectReader = (id: string) => Promise<{ deadline: string | null } | null>;
/** The live parts among the ids. A missing id is unknown or deleted. */
export type PartLookup = (
  ids: string[],
) => Promise<ReadonlyMap<string, { name: string; estimatedPrintSeconds: number }>>;
/** The live, not archived printers among the ids. */
export type PrinterLookup = (ids: string[]) => Promise<ReadonlyMap<string, { name: string }>>;
/** The intervention rules in force (version 0: the defaults). */
export type ScheduleReader = () => Promise<ScheduleRules & { version: number }>;

export interface SimulationResult {
  readonly projectId: string;
  readonly goal: Goal;
  readonly startAt: number;
  readonly simulation: Simulation;
  readonly partNames: ReadonlyMap<string, string>;
  readonly printerNames: ReadonlyMap<string, string>;
  readonly deadline: { date: string | null; met: boolean | null };
  readonly warnings: readonly SimulationWarningCode[];
}

export interface SimulationsService {
  simulate(input: { projectId: string; startAt: string }): Promise<SimulationResult>;
}

const invalid = (issue: FieldIssue): AppError =>
  new AppError('validation_failed', 'The request is not valid.', { issues: [issue] });

/** Fails closed: a dependency that breaks is a 503, never "the record does not exist". */
async function dependable<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The planning data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createSimulationsService(deps: {
  queueReader: QueueReader;
  projectReader: ProjectReader;
  partLookup: PartLookup;
  printerLookup: PrinterLookup;
  scheduleReader: ScheduleReader;
}): SimulationsService {
  return {
    async simulate({ projectId, startAt: startText }) {
      const startAt = parseLocalMinutes(startText);
      if (startAt === null) throw invalid({ path: 'startAt', message: 'Not a valid local time.' });

      const queue = await dependable(() => deps.queueReader(projectId));
      if (queue === null) {
        throw invalid({ path: 'projectId', message: 'The project has no queue.' });
      }

      const pending = queue.lines.filter((line) => line.quantity > line.completed);
      const totalUnits = pending.reduce((sum, line) => sum + line.quantity - line.completed, 0);
      if (totalUnits > MAX_UNITS) {
        throw invalid({
          path: 'lines',
          message: `too_many_units: ${String(totalUnits)} units are left; at most ${String(MAX_UNITS)} can be simulated.`,
        });
      }

      const [project, parts, printers, schedule] = await Promise.all([
        dependable(() => deps.projectReader(projectId)),
        pending.length === 0
          ? Promise.resolve(new Map<string, { name: string; estimatedPrintSeconds: number }>())
          : dependable(() => deps.partLookup([...new Set(pending.map((line) => line.partId))])),
        dependable(() => deps.printerLookup([...queue.printerIds])),
        dependable(() => deps.scheduleReader()),
      ]);
      if (project === null) {
        throw invalid({ path: 'projectId', message: 'The project does not exist.' });
      }

      const printerIds = queue.printerIds.filter((id) => printers.has(id));
      if (printerIds.length === 0) {
        throw invalid({ path: 'printerIds', message: 'No selected printer is available.' });
      }

      const warnings: SimulationWarningCode[] = [];
      if (schedule.version === 0) warnings.push('availability_not_configured');
      if (printerIds.length < queue.printerIds.length) warnings.push('printer_unavailable');
      if (pending.some((line) => !parts.has(line.partId))) warnings.push('part_deleted');

      const lines: SimulationLine[] = pending.flatMap((line) => {
        const part = parts.get(line.partId);
        return part === undefined
          ? []
          : [
              {
                partId: line.partId,
                units: line.quantity - line.completed,
                minutes: minutesOf(part.estimatedPrintSeconds),
              },
            ];
      });
      if (lines.length === 0) warnings.push('nothing_to_print');

      const simulation = simulateNaive({ schedule, startAt, lines, printerIds });
      const unplacedUnits = simulation.unplaced.reduce((sum, entry) => sum + entry.units, 0);
      return {
        projectId,
        goal: queue.goal,
        startAt,
        simulation,
        partNames: new Map([...parts].map(([id, part]) => [id, part.name])),
        printerNames: new Map([...printers].map(([id, printer]) => [id, printer.name])),
        deadline: {
          date: project.deadline,
          met: deadlineMet(project.deadline, simulation.finishAt, unplacedUnits),
        },
        warnings,
      };
    },
  };
}
