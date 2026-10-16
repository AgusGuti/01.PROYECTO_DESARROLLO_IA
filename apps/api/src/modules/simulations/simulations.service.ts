// Use cases: simulate (CU10) and optimise (CU08) the planning of a project. Stateless: they read
// through ports owned here (ADR 0017, 0026, 0027) and write nothing. No HTTP, no MongoDB.
import { AppError, type FieldIssue } from '../../shared/errors/app-error.js';
import type { ScheduleRules } from '../availability/index.js';
import {
  deadlineMet,
  type Goal,
  MAX_UNITS,
  minutesOf,
  parseLocalMinutes,
  simulateNaive,
  type Simulation,
  type SimulationWarningCode,
} from './simulations.domain.js';
import {
  deadlineChange,
  optimize,
  type Candidate,
  type OptimizerLine,
  type Strategy,
} from './simulations.optimizer.js';

export type { Goal };

/** The queue of a project as stored; null when the project has none. */
export type QueueReader = (projectId: string) => Promise<{
  goal: Goal;
  mode: 'single' | 'multi';
  printerIds: readonly string[];
  lines: readonly { partId: string; quantity: number; completed: number }[];
} | null>;
/** A live project's deadline as `YYYY-MM-DD` or null; a null result: unknown or removed. */
export type ProjectReader = (id: string) => Promise<{ deadline: string | null } | null>;

export interface PartData {
  name: string;
  estimatedPrintSeconds: number;
  /** Bounding box in mm; only the optimiser uses it, to batch identical pieces. */
  dimensionsMm: { x: number; y: number; z: number };
}
export interface PrinterData {
  name: string;
  /** Usable volume in mm; only the optimiser uses it, to batch identical pieces. */
  buildVolume: { x: number; y: number; z: number };
}
/** The live parts among the ids. A missing id is unknown or deleted. */
export type PartLookup = (ids: string[]) => Promise<ReadonlyMap<string, PartData>>;
/** The live, not archived printers among the ids. */
export type PrinterLookup = (ids: string[]) => Promise<ReadonlyMap<string, PrinterData>>;
/** The intervention rules in force (version 0: the defaults). */
export type ScheduleReader = () => Promise<ScheduleRules & { version: number }>;
/** The planning settings in force (the defaults when never saved). */
export type PlanningReader = () => Promise<{ batchSavingBasisPoints: number }>;

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

export interface OptimizationResult {
  readonly projectId: string;
  readonly goal: Goal;
  readonly startAt: number;
  readonly strategy: Strategy;
  readonly baseline: Candidate;
  readonly optimized: Candidate;
  readonly candidates: readonly Candidate[];
  readonly comparison: {
    readonly finishDeltaMinutes: number | null;
    readonly idleDeltaMinutes: number;
    readonly deadlineChanged: 'gained' | 'lost' | 'same' | 'unknown';
  };
  readonly deadlineDate: string | null;
  readonly partNames: ReadonlyMap<string, string>;
  readonly printerNames: ReadonlyMap<string, string>;
  readonly warnings: readonly SimulationWarningCode[];
}

export interface SimulationsService {
  simulate(input: { projectId: string; startAt: string }): Promise<SimulationResult>;
  optimize(input: { projectId: string; startAt: string }): Promise<OptimizationResult>;
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

interface Prepared {
  readonly startAt: number;
  readonly goal: Goal;
  readonly deadline: string | null;
  readonly schedule: ScheduleRules;
  readonly printerIds: readonly string[];
  readonly printers: ReadonlyMap<string, PrinterData>;
  readonly parts: ReadonlyMap<string, PartData>;
  /** Remaining units of the live parts, in queue-line order. */
  readonly lines: readonly (OptimizerLine & { minutes: number })[];
  readonly warnings: SimulationWarningCode[];
}

const namesOf = (source: ReadonlyMap<string, { name: string }>): Map<string, string> =>
  new Map([...source].map(([id, item]) => [id, item.name]));

export function createSimulationsService(deps: {
  queueReader: QueueReader;
  projectReader: ProjectReader;
  partLookup: PartLookup;
  printerLookup: PrinterLookup;
  scheduleReader: ScheduleReader;
  planningReader: PlanningReader;
}): SimulationsService {
  /** Reads and checks what both use cases share: they have the same preconditions. */
  async function prepare(projectId: string, startText: string): Promise<Prepared> {
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
        ? Promise.resolve(new Map<string, PartData>())
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

    const lines = pending.flatMap((line) => {
      const part = parts.get(line.partId);
      return part === undefined
        ? []
        : [
            {
              partId: line.partId,
              units: line.quantity - line.completed,
              minutes: minutesOf(part.estimatedPrintSeconds),
              seconds: part.estimatedPrintSeconds,
              size: part.dimensionsMm,
            },
          ];
    });
    if (lines.length === 0) warnings.push('nothing_to_print');

    return {
      startAt,
      goal: queue.goal,
      deadline: project.deadline,
      schedule,
      printerIds,
      printers,
      parts,
      lines,
      warnings,
    };
  }

  return {
    async simulate({ projectId, startAt: startText }) {
      const plan = await prepare(projectId, startText);
      const simulation = simulateNaive({
        schedule: plan.schedule,
        startAt: plan.startAt,
        lines: plan.lines,
        printerIds: plan.printerIds,
      });
      const unplacedUnits = simulation.unplaced.reduce((sum, entry) => sum + entry.units, 0);
      return {
        projectId,
        goal: plan.goal,
        startAt: plan.startAt,
        simulation,
        partNames: namesOf(plan.parts),
        printerNames: namesOf(plan.printers),
        deadline: {
          date: plan.deadline,
          met: deadlineMet(plan.deadline, simulation.finishAt, unplacedUnits),
        },
        warnings: plan.warnings,
      };
    },

    async optimize({ projectId, startAt: startText }) {
      const plan = await prepare(projectId, startText);
      const settings = await dependable(() => deps.planningReader());
      const result = optimize({
        schedule: plan.schedule,
        startAt: plan.startAt,
        lines: plan.lines,
        printers: plan.printerIds.flatMap((printerId) => {
          const printer = plan.printers.get(printerId);
          return printer === undefined ? [] : [{ printerId, bed: printer.buildVolume }];
        }),
        batchSavingBasisPoints: settings.batchSavingBasisPoints,
        goal: plan.goal,
        deadline: plan.deadline,
      });
      const { baseline, optimized } = result;
      const warnings = [...plan.warnings];
      if (optimized.plan.jobs.some((job) => job.units > 1)) warnings.push('batching_applied');
      const before = baseline.metrics.finishAt;
      const after = optimized.metrics.finishAt;
      return {
        projectId,
        goal: plan.goal,
        startAt: plan.startAt,
        strategy: result.strategy,
        baseline,
        optimized,
        candidates: result.candidates,
        comparison: {
          // Null when only one of the two plans placed anything: there is nothing to subtract.
          finishDeltaMinutes:
            before === null || after === null ? (before === after ? 0 : null) : after - before,
          idleDeltaMinutes: optimized.metrics.totalIdleMinutes - baseline.metrics.totalIdleMinutes,
          deadlineChanged: deadlineChange(
            baseline.metrics.deadlineMet,
            optimized.metrics.deadlineMet,
          ),
        },
        deadlineDate: plan.deadline,
        partNames: namesOf(plan.parts),
        printerNames: namesOf(plan.printers),
        warnings,
      };
    },
  };
}
