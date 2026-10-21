// Zod schemas for the queues API: the source of the OpenAPI contract (standard §7.1).
// Every input object is strict, so an unknown key (`id`, `createdAt`, `totals`...) is a 400.
import { materialSchema } from '../../shared/catalog/materials.schemas.js';
import { z } from '../../shared/http/zod.js';
import {
  GOALS,
  lineIssues,
  MAX_LINES,
  MAX_PRINTERS,
  MAX_QUANTITY,
  MODES,
  printerSelectionIssues,
  type Mode,
} from './queues.domain.js';

const idSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Must be a 24-character hexadecimal id.')
  // Lower case, so the same id written two ways is one id (duplicates, the unique _id).
  .toLowerCase()
  .openapi({ example: '66f0c0ffee0123456789abcd' });

const goalSchema = z.enum(GOALS).openapi({
  description: 'deadline: meet deadlines. fastest: finish earliest. minimal_idle: least idle time.',
});
const modeSchema = z.enum(MODES).openapi({ description: 'single: one printer. multi: 2 to 10.' });
const printerIdsSchema = z.array(idSchema).max(MAX_PRINTERS).openapi({
  description:
    'Live, not archived printers. Single mode: exactly 1. Multi mode: 2 to 10. No repeats.',
});

// The spool is required on every saved line (ADR 0036): null, missing or malformed is a 400.
const lineShape = {
  partId: idSchema,
  filamentId: idSchema.openapi({ description: 'The spool of the line. Required.' }),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
};
const completedSchema = z.number().int().min(0).max(MAX_QUANTITY);

// On create the completed count is 0 (default); on edit it is required, so replacing the lines can
// never silently zero the progress.
const lineInputSchema = z
  .strictObject({ ...lineShape, completed: z.literal(0).default(0) })
  .openapi('QueueLineInput');
const lineEditSchema = z
  .strictObject({ ...lineShape, completed: completedSchema })
  .openapi('QueueLineEdit');

const LINES_DESCRIPTION =
  'Up to 100 lines, each (part, spool) pair at most once, completed at most the quantity. A part ' +
  'may repeat with different spools.';
const linesSchema = z
  .array(lineInputSchema)
  .max(MAX_LINES)
  .openapi({ description: LINES_DESCRIPTION });
const editLinesSchema = z
  .array(lineEditSchema)
  .max(MAX_LINES)
  .openapi({ description: LINES_DESCRIPTION + ' completed is required.' });

interface Checked {
  mode?: Mode | undefined;
  printerIds?: string[] | undefined;
  lines?: { partId: string; filamentId: string; quantity: number; completed: number }[] | undefined;
}

// Shape rules with indexed paths, so they are a 400 before any lookup (ADR 0025).
function checkShape(body: Checked, ctx: z.RefinementCtx): void {
  const issues = [
    ...(body.printerIds === undefined ? [] : printerSelectionIssues(body.mode, body.printerIds)),
    ...(body.lines === undefined ? [] : lineIssues(body.lines)),
  ];
  for (const issue of issues) {
    ctx.addIssue({ code: 'custom', path: issue.path.split('.'), message: issue.message });
  }
}

export const createQueueSchema = z
  .strictObject({
    projectId: idSchema,
    goal: goalSchema,
    mode: modeSchema,
    printerIds: printerIdsSchema,
    lines: linesSchema.optional().openapi({
      description:
        'Omit to copy the project lines (with their spools) and completed 0; every project line ' +
        'must have a spool. The queue keeps its own copy: later edits to the project do not ' +
        'change it. completed must be 0 on create.',
    }),
  })
  .superRefine(checkShape)
  .openapi('CreateQueueRequest');

/** `version` is the version the client last saw (ADR 0008). `lines` is replaced whole. */
export const updateQueueSchema = z
  .strictObject({
    version: z.number().int().min(1),
    goal: goalSchema.optional(),
    mode: modeSchema.optional(),
    printerIds: printerIdsSchema.optional(),
    lines: editLinesSchema.optional(),
  })
  .superRefine(checkShape)
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'Provide at least one field to change besides version.',
  })
  .openapi('UpdateQueueRequest');

export const queueParamsSchema = z.strictObject({ projectId: idSchema });

export const deleteQueueQuerySchema = z.strictObject({
  version: z
    .string()
    .regex(/^\d{1,9}$/, 'Must be a whole number.')
    .transform(Number)
    .pipe(z.number().int().min(1))
    .openapi({ type: 'integer', minimum: 1 }),
});

const timestamp = z.iso.datetime().openapi({ example: '2026-01-01T12:00:00.000Z' });

export const queueLineSchema = z
  .object({
    partId: z.string(),
    filamentId: z
      .string()
      .nullable()
      .openapi({
        type: ['string', 'null'],
        description: 'The spool of the line; null only for a line saved before ADR 0036.',
      }),
    quantity: z.number().int(),
    completed: z.number().int(),
    pendingUnits: z.number().int(),
    partName: z.string().nullable(),
    estimatedPrintSeconds: z.number().int().nullable(),
    partDeleted: z.boolean().openapi({ description: 'The part is no longer live.' }),
    filament: z
      .object({
        brand: z.string(),
        material: materialSchema,
        colorName: z.string(),
        availableGrams: z.number().int(),
      })
      .nullable()
      .openapi({
        description:
          'The spool as it is now, or null when the line has no spool or it is not live.',
      }),
    filamentDeleted: z.boolean().openapi({
      description: 'The line has a spool id but that spool is no longer live: choose another.',
    }),
  })
  .openapi('QueueLine');

export const queueTotalsSchema = z
  .object({
    totalUnits: z.number().int(),
    completedUnits: z.number().int(),
    pendingUnits: z.number().int(),
    pendingSeconds: z.number().int().openapi({
      description: 'Pending units times print time. Lines with a deleted part count 0.',
    }),
  })
  .openapi('QueueTotals');

export const queueSchema = z
  .object({
    projectId: z.string(),
    goal: goalSchema,
    mode: modeSchema,
    printerIds: z.array(z.string()),
    lines: z.array(queueLineSchema),
    totals: queueTotalsSchema,
    version: z.number().int().openapi({ description: 'Send this back when editing.' }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi('Queue');

export type CreateQueueInput = z.infer<typeof createQueueSchema>;
export type UpdateQueueInput = z.infer<typeof updateQueueSchema>;
export type QueueDto = z.infer<typeof queueSchema>;
