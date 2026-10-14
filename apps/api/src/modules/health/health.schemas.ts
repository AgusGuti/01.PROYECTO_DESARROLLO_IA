// Public response shapes (DTOs) for this module. These Zod schemas are the single source of the
// contract: the OpenAPI document and the Angular types are generated from them (standard §7.1).
import { z } from '../../shared/http/zod.js';

const timestamp = z.iso.datetime().openapi({ example: '2026-01-01T12:00:00.000Z' });

export const livenessSchema = z
  .object({
    status: z.literal('ok'),
    uptimeSeconds: z.number().int().nonnegative().openapi({ example: 3600 }),
    timestamp,
  })
  .openapi('Liveness');

export const readinessSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.object({ database: z.enum(['up', 'down']) }),
    timestamp,
  })
  .openapi('Readiness');

export type LivenessDto = z.infer<typeof livenessSchema>;
export type ReadinessDto = z.infer<typeof readinessSchema>;
