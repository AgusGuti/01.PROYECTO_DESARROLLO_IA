// Zod schemas for the planning settings API: the source of the OpenAPI contract (standard §7.1).
import { z } from '../../shared/http/zod.js';
import { MAX_BATCH_SAVING_BASIS_POINTS } from './planning.domain.js';

export const updatePlanningSettingsSchema = z
  .strictObject({
    batchSavingBasisPoints: z.number().int().min(0).max(MAX_BATCH_SAVING_BASIS_POINTS).openapi({
      description:
        'Time saved when identical pieces share a plate, in basis points: 1000 is 10 %. 0 to 5000.',
    }),
    version: z.number().int().min(0).openapi({
      description: '0 for the first save, otherwise the version last seen (ADR 0027).',
    }),
  })
  .openapi('UpdatePlanningSettingsRequest');

export const planningSettingsSchema = z
  .object({
    batchSavingBasisPoints: z.number().int(),
    version: z.number().int().openapi({ description: '0 until the settings are first saved.' }),
    updatedAt: z.iso.datetime().nullable().openapi({ example: '2026-01-01T12:00:00.000Z' }),
  })
  .openapi('PlanningSettings');

export type UpdatePlanningSettingsInput = z.infer<typeof updatePlanningSettingsSchema>;
export type PlanningSettingsDto = z.infer<typeof planningSettingsSchema>;
