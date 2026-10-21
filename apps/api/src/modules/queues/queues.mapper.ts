// Internal queue -> response DTO. Fields are copied one by one, so nothing internal can leak.
import { pendingOf, type QueueDetail } from './queues.domain.js';
import type { QueueDto } from './queues.schemas.js';

export function toQueueDto({ queue, parts, filaments, totals }: QueueDetail): QueueDto {
  return {
    projectId: queue.id,
    goal: queue.goal,
    mode: queue.mode,
    printerIds: [...queue.printerIds],
    lines: queue.lines.map((line) => {
      const part = parts.get(line.partId);
      const filament = line.filamentId === null ? undefined : filaments.get(line.filamentId);
      return {
        partId: line.partId,
        filamentId: line.filamentId,
        quantity: line.quantity,
        completed: line.completed,
        pendingUnits: pendingOf(line),
        partName: part?.name ?? null,
        estimatedPrintSeconds: part?.estimatedPrintSeconds ?? null,
        partDeleted: part === undefined,
        filament:
          filament === undefined
            ? null
            : {
                brand: filament.brand,
                material: filament.material,
                colorName: filament.colorName,
                availableGrams: filament.availableGrams,
              },
        filamentDeleted: line.filamentId !== null && filament === undefined,
      };
    }),
    totals: {
      totalUnits: totals.totalUnits,
      completedUnits: totals.completedUnits,
      pendingUnits: totals.pendingUnits,
      pendingSeconds: totals.pendingSeconds,
    },
    version: queue.version,
    createdAt: queue.createdAt.toISOString(),
    updatedAt: queue.updatedAt.toISOString(),
  };
}
