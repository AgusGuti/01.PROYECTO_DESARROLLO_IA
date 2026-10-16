// Zod schemas for the simulations API: the source of the OpenAPI contract (standard §7.1).
// The input is strict: an unknown key is a 400. The output lists every field it exposes.
import { z } from '../../shared/http/zod.js';
import { parseLocalMinutes, SIMULATION_WARNING_CODES } from './simulations.domain.js';
import { STRATEGIES } from './simulations.optimizer.js';

const idSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Must be a 24-character hexadecimal id.')
  .toLowerCase()
  .openapi({ example: '66f0c0ffee0123456789abcd' });

const localDateTime = z.string().openapi({
  example: '2026-03-02T08:00',
  description: 'Wall-clock time of America/Argentina/Buenos_Aires: YYYY-MM-DDTHH:mm.',
});

export const simulationRequestSchema = z
  .strictObject({
    projectId: idSchema,
    startAt: z
      .string()
      .max(16)
      .refine((value) => parseLocalMinutes(value) !== null, {
        message: 'Must be a real local date and time, YYYY-MM-DDTHH:mm, years 2000 to 2099.',
      })
      .openapi({
        example: '2026-03-02T08:00',
        description:
          'When the simulation starts, in Argentina time, without seconds and without a zone suffix.',
      }),
  })
  .openapi('SimulationRequest');

export const simulationWarningCodeSchema = z
  .enum(SIMULATION_WARNING_CODES)
  .openapi('SimulationWarningCode');

const minutes = (description: string) => z.number().int().openapi({ description });

export const simulationSchema = z
  .object({
    projectId: idSchema,
    goal: z.enum(['deadline', 'fastest', 'minimal_idle']).openapi({
      description: 'Echoed for display. The naive ordering does not use it.',
    }),
    startAt: localDateTime,
    jobs: z.array(
      z.object({
        order: z.number().int(),
        partId: idSchema,
        partName: z.string(),
        unit: z.number().int().openapi({ description: '1-based unit within its queue line.' }),
        unitsInLine: z.number().int(),
        printerId: idSchema,
        startAt: localDateTime,
        endAt: localDateTime,
        handoffAt: localDateTime.openapi({
          description:
            'When the piece is removed: the first intervention minute at or after endAt.',
        }),
        unattended: z.boolean().openapi({
          description:
            'Some minute of the print has no intervention possible (for example the night).',
        }),
      }),
    ),
    printers: z.array(
      z.object({
        printerId: idSchema,
        name: z.string(),
        jobs: z.number().int(),
        busyMinutes: minutes('Sum of the printing time of its jobs (endAt - startAt).'),
        idleMinutes: minutes(
          'Sum of the waiting time of its jobs: finished, not yet collected (handoffAt - endAt).',
        ),
      }),
    ),
    totals: z.object({
      placedJobs: z.number().int(),
      unplacedJobs: z.number().int(),
      finishAt: localDateTime.nullable().openapi({ description: 'The last handoff, if any.' }),
      totalBusyMinutes: z.number().int(),
      totalIdleMinutes: z.number().int(),
    }),
    deadline: z.object({
      date: z.string().nullable().openapi({ example: '2026-03-20' }),
      met: z.boolean().nullable().openapi({
        description:
          'Null without a deadline or with nothing to place; false if anything is unplaced.',
      }),
    }),
    unplaced: z.array(
      z.object({ partId: idSchema, partName: z.string(), units: z.number().int() }),
    ),
    warnings: z.array(z.object({ code: simulationWarningCodeSchema })),
  })
  .openapi('Simulation');

export type SimulationRequestInput = z.infer<typeof simulationRequestSchema>;
export type SimulationDto = z.infer<typeof simulationSchema>;

// ---- CU08: the optimiser (ADR 0027, 0028). It takes the same request body as the simulation. ----

const strategySchema = z.enum(STRATEGIES).openapi('OptimizationStrategy', {
  description:
    'naive: the CU10 result. queue_order: queue order with batching. longest_first and ' +
    'shortest_first: plates sorted by duration. best_fit: at each start, the plate that leaves ' +
    'the least waiting time before it is collected.',
});

const optimizationTotalsSchema = z.object({
  placedPlates: z
    .number()
    .int()
    .openapi({ description: 'Plates printed; each is one collection of the printer.' }),
  placedUnits: z.number().int(),
  unplacedUnits: z.number().int(),
  finishAt: localDateTime.nullable().openapi({ description: 'The last handoff, if any.' }),
  totalBusyMinutes: z.number().int(),
  totalIdleMinutes: z.number().int(),
});

const deadlineSchema = z.object({
  date: z.string().nullable().openapi({ example: '2026-03-20' }),
  met: z.boolean().nullable().openapi({
    description: 'Null without a deadline or with nothing to place; false if anything is unplaced.',
  }),
});

const unplacedSchema = z.array(
  z.object({ partId: idSchema, partName: z.string(), units: z.number().int() }),
);

export const optimizationSchema = z
  .object({
    projectId: idSchema,
    goal: z.enum(['deadline', 'fastest', 'minimal_idle']).openapi({
      description:
        'fastest: earliest finish, then less idle. minimal_idle: less total idle, then earlier ' +
        'finish. deadline: deadline met first, then earliest finish, then less idle.',
    }),
    startAt: localDateTime,
    strategy: strategySchema.openapi({ description: 'The strategy whose plan is `optimized`.' }),
    baseline: z
      .object({
        totals: optimizationTotalsSchema,
        deadline: deadlineSchema,
        unplaced: unplacedSchema,
      })
      .openapi({ description: 'The naive plan (CU10), with no batching.' }),
    optimized: z.object({
      jobs: z.array(
        z.object({
          order: z.number().int(),
          partId: idSchema,
          partName: z.string(),
          units: z.number().int().openapi({ description: 'Identical pieces on this plate.' }),
          plateIndex: z.number().int().openapi({ description: '1-based plate within its line.' }),
          platesInLine: z.number().int(),
          printerId: idSchema,
          startAt: localDateTime,
          endAt: localDateTime,
          handoffAt: localDateTime,
          unattended: z.boolean(),
        }),
      ),
      printers: z.array(
        z.object({
          printerId: idSchema,
          name: z.string(),
          jobs: z.number().int(),
          busyMinutes: z.number().int(),
          idleMinutes: z.number().int(),
        }),
      ),
      totals: optimizationTotalsSchema,
      deadline: deadlineSchema,
      unplaced: unplacedSchema,
    }),
    comparison: z.object({
      finishDeltaMinutes: z.number().int().nullable().openapi({
        description: 'optimized - baseline finish, negative is better. Null if only one placed.',
      }),
      idleDeltaMinutes: z
        .number()
        .int()
        .openapi({ description: 'optimized - baseline idle, negative is better.' }),
      deadlineChanged: z.enum(['gained', 'lost', 'same', 'unknown']),
    }),
    candidates: z
      .array(
        z.object({
          strategy: strategySchema,
          finishAt: localDateTime.nullable(),
          totalIdleMinutes: z.number().int(),
          deadlineMet: z.boolean().nullable(),
          placedUnits: z.number().int(),
          unplacedUnits: z.number().int(),
        }),
      )
      .openapi({ description: 'Every strategy that was tried, for explainability.' }),
    warnings: z.array(z.object({ code: simulationWarningCodeSchema })),
  })
  .openapi('Optimization');

export type OptimizationDto = z.infer<typeof optimizationSchema>;
