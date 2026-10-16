// Internal simulation -> response DTO. Fields are copied one by one, so nothing internal can leak.
import { formatLocalMinutes } from './simulations.domain.js';
import type { SimulationDto } from './simulations.schemas.js';
import type { SimulationResult } from './simulations.service.js';

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
