// Internal simulation -> response DTO. Fields are copied one by one, so nothing internal can leak.
import { formatLocalMinutes } from './simulations.domain.js';
import type { Candidate } from './simulations.optimizer.js';
import type { OptimizationDto, SimulationDto } from './simulations.schemas.js';
import type { OptimizationResult, SimulationResult } from './simulations.service.js';

export function toSimulationDto(result: SimulationResult): SimulationDto {
  const { simulation, partNames, printerNames } = result;
  const unplacedJobs = simulation.unplaced.reduce((sum, entry) => sum + entry.units, 0);
  return {
    projectId: result.projectId,
    goal: result.goal,
    startAt: formatLocalMinutes(result.startAt),
    jobs: simulation.jobs.map((job) => ({
      order: job.order,
      partId: job.partId,
      partName: partNames.get(job.partId) ?? '',
      unit: job.unit,
      unitsInLine: job.unitsInLine,
      printerId: job.printerId,
      startAt: formatLocalMinutes(job.start),
      endAt: formatLocalMinutes(job.end),
      handoffAt: formatLocalMinutes(job.handoff),
      unattended: job.unattended,
    })),
    printers: simulation.printers.map((printer) => ({
      printerId: printer.printerId,
      name: printerNames.get(printer.printerId) ?? '',
      jobs: printer.jobs,
      busyMinutes: printer.busyMinutes,
      idleMinutes: printer.idleMinutes,
    })),
    totals: {
      placedJobs: simulation.jobs.length,
      unplacedJobs,
      finishAt: simulation.finishAt === null ? null : formatLocalMinutes(simulation.finishAt),
      totalBusyMinutes: simulation.printers.reduce((sum, p) => sum + p.busyMinutes, 0),
      totalIdleMinutes: simulation.printers.reduce((sum, p) => sum + p.idleMinutes, 0),
    },
    deadline: { date: result.deadline.date, met: result.deadline.met },
    unplaced: simulation.unplaced.map((entry) => ({
      partId: entry.partId,
      partName: partNames.get(entry.partId) ?? '',
      units: entry.units,
    })),
    warnings: result.warnings.map((code) => ({ code })),
  };
}

function toCandidateParts(
  candidate: Candidate,
  deadlineDate: string | null,
  partNames: ReadonlyMap<string, string>,
) {
  const { plan, metrics } = candidate;
  return {
    totals: {
      placedPlates: plan.jobs.length,
      placedUnits: metrics.placedUnits,
      unplacedUnits: metrics.unplacedUnits,
      finishAt: plan.finishAt === null ? null : formatLocalMinutes(plan.finishAt),
      totalBusyMinutes: plan.printers.reduce((sum, p) => sum + p.busyMinutes, 0),
      totalIdleMinutes: metrics.totalIdleMinutes,
    },
    deadline: { date: deadlineDate, met: metrics.deadlineMet },
    unplaced: plan.unplaced.map((entry) => ({
      partId: entry.partId,
      partName: partNames.get(entry.partId) ?? '',
      units: entry.units,
    })),
  };
}

export function toOptimizationDto(result: OptimizationResult): OptimizationDto {
  const { partNames, printerNames, optimized, baseline } = result;
  const base = toCandidateParts(baseline, result.deadlineDate, partNames);
  const best = toCandidateParts(optimized, result.deadlineDate, partNames);
  return {
    projectId: result.projectId,
    goal: result.goal,
    startAt: formatLocalMinutes(result.startAt),
    strategy: result.strategy,
    baseline: base,
    optimized: {
      jobs: optimized.plan.jobs.map((job) => ({
        order: job.order,
        partId: job.partId,
        partName: partNames.get(job.partId) ?? '',
        units: job.units,
        plateIndex: job.plateIndex,
        platesInLine: job.platesInLine,
        printerId: job.printerId,
        startAt: formatLocalMinutes(job.start),
        endAt: formatLocalMinutes(job.end),
        handoffAt: formatLocalMinutes(job.handoff),
        unattended: job.unattended,
      })),
      printers: optimized.plan.printers.map((printer) => ({
        printerId: printer.printerId,
        name: printerNames.get(printer.printerId) ?? '',
        jobs: printer.jobs,
        busyMinutes: printer.busyMinutes,
        idleMinutes: printer.idleMinutes,
      })),
      ...best,
    },
    comparison: {
      finishDeltaMinutes: result.comparison.finishDeltaMinutes,
      idleDeltaMinutes: result.comparison.idleDeltaMinutes,
      deadlineChanged: result.comparison.deadlineChanged,
    },
    candidates: result.candidates.map(({ strategy, metrics }) => ({
      strategy,
      finishAt: metrics.finishAt === null ? null : formatLocalMinutes(metrics.finishAt),
      totalIdleMinutes: metrics.totalIdleMinutes,
      deadlineMet: metrics.deadlineMet,
      placedUnits: metrics.placedUnits,
      unplacedUnits: metrics.unplacedUnits,
    })),
    warnings: result.warnings.map((code) => ({ code })),
  };
}
