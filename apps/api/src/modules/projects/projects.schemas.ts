// Zod schemas for the projects API: the source of the OpenAPI contract (standard §7.1).
// Every input object is strict, so an unknown key (`id`, `version` on create, `deletedAt`,
// `status`...) is a 400 and can never reach a model.
import { materialSchema } from '../../shared/catalog/materials.schemas.js';
import { z } from '../../shared/http/zod.js';
import { MAX_ITEMS, PRIORITIES, PROJECT_SORTS } from './projects.domain.js';

const CONTROL_CHARACTER = /\p{Cc}/u;
// Unicode code points, not UTF-16 units: an emoji counts as one character.
const codePoints = (value: string): number => Array.from(value).length;

/** Trimmed, NFC-normalised, 1..max code points, no control characters (newline, NUL...). */
const textSchema = (max: number, example: string) =>
  z
    .string()
    // Checked on the raw text, so "abc\n" is rejected instead of silently trimmed.
    .refine((value) => !CONTROL_CHARACTER.test(value), 'Must not contain control characters.')
    .transform((value) => value.trim().normalize('NFC'))
    .refine((value) => codePoints(value) >= 1, 'Must not be empty.')
    .refine((value) => codePoints(value) <= max, `Must be at most ${String(max)} characters.`)
    .openapi({ type: 'string', minLength: 1, maxLength: max, example });

const nameSchema = textSchema(100, 'Soportes para el taller');
const descriptionSchema = textSchema(1000, 'Estantes y herramientas del taller.');
const clearableDescriptionSchema = descriptionSchema
  .nullable()
  .openapi({ type: ['string', 'null'], minLength: 1, maxLength: 1000 });

const prioritySchema = z.enum(PRIORITIES).openapi({
  description: 'From the least to the most urgent: low, normal, high, urgent.',
});

const DEADLINE_DESCRIPTION =
  'YYYY-MM-DD, a calendar day (no time zone), years 2000..2099. A past day is allowed.';

// A real calendar date, stored as a UTC-midnight Date (ADR 0011).
const deadlineSchema = z.iso
  .date()
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= 2000 && year <= 2099;
  }, 'The year must be between 2000 and 2099.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .openapi({
    type: 'string',
    format: 'date',
    example: '2026-11-30',
    description: DEADLINE_DESCRIPTION,
  });
const clearableDeadlineSchema = deadlineSchema.nullable().openapi({
  type: ['string', 'null'],
  format: 'date',
  example: '2026-11-30',
  description: `${DEADLINE_DESCRIPTION} null clears it.`,
});

const partIdSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Must be a 24-character hexadecimal id.')
  // Lower case, so the same id written two ways is one id (duplicates, lookup by string).
  .toLowerCase()
  .openapi({ example: '66f0c0ffee0123456789abcd' });

const itemInputSchema = z
  .strictObject({
    partId: partIdSchema,
    quantity: z.number().int().min(1).max(1000),
  })
  .openapi('ProjectItemInput');

const itemsInputSchema = z.array(itemInputSchema).max(MAX_ITEMS).openapi({
  description:
    'Up to 100 lines, each part at most once, every part must exist. Replaced whole on edit.',
});

export const createProjectSchema = z
  .strictObject({
    name: nameSchema,
    description: descriptionSchema.optional(),
    priority: prioritySchema.default('normal'),
    deadline: deadlineSchema.optional(),
    items: itemsInputSchema.default([]),
  })
  .openapi('CreateProjectRequest');

/**
 * `version` is the version the client last saw (ADR 0008). `items` is replaced whole when
 * present (`[]` empties it). `null` clears `description` or `deadline`.
 */
export const updateProjectSchema = z
  .strictObject({
    version: z.number().int().min(1),
    name: nameSchema.optional(),
    description: clearableDescriptionSchema.optional(),
    priority: prioritySchema.optional(),
    deadline: clearableDeadlineSchema.optional(),
    items: itemsInputSchema.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'Provide at least one field to change besides version.',
  })
  .openapi('UpdateProjectRequest');

export const projectIdParamsSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'Must be a 24-character hexadecimal id.')
    .openapi({ example: '66f0c0ffee0123456789abcd' }),
});

// Query strings arrive as text. Only plain digits are accepted ("1e2", "0x10" and " 5" are not).
const wholeNumber = (min: number, max: number, fallback: number) =>
  z
    .string()
    .regex(/^\d{1,9}$/, 'Must be a whole number.')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .default(fallback)
    .openapi({ type: 'integer', minimum: min, maximum: max, default: fallback });

export const listProjectsQuerySchema = z.strictObject({
  page: wholeNumber(1, 10_000, 1),
  pageSize: wholeNumber(1, 100, 20),
  priority: prioritySchema.optional(),
  sort: z.enum(PROJECT_SORTS).default('createdAt').openapi({
    description: 'A project without a deadline comes last in both directions when sorting by it.',
  }),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const timestamp = z.iso.datetime().openapi({ example: '2026-01-01T12:00:00.000Z' });
const id = z.string().openapi({ example: '66f0c0ffee0123456789abcd' });
const deadlineOutput = z
  .string()
  .nullable()
  .openapi({
    type: ['string', 'null'],
    format: 'date',
    example: '2026-11-30',
    description: 'YYYY-MM-DD, a calendar day (no time zone), or null.',
  });

export const projectItemSchema = z
  .object({
    partId: id,
    quantity: z.number().int(),
    part: z.object({ name: z.string(), material: materialSchema }).nullable().openapi({
      description: 'The part as it is now, or null when it is no longer live ("deleted").',
    }),
  })
  .openapi('ProjectItem');

export const projectSchema = z
  .object({
    id,
    name: z.string(),
    description: z.string().nullable(),
    priority: prioritySchema,
    deadline: deadlineOutput,
    items: z.array(projectItemSchema),
    version: z.number().int().openapi({ description: 'Send this back when editing.' }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi('Project');

export const projectSummarySchema = z
  .object({
    id,
    name: z.string(),
    description: z.string().nullable(),
    priority: prioritySchema,
    deadline: deadlineOutput,
    itemCount: z.number().int().openapi({ description: 'Number of lines.' }),
    unitCount: z.number().int().openapi({ description: 'Sum of the quantities.' }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi('ProjectSummary');

export const projectListSchema = z
  .object({
    items: z.array(projectSummarySchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .openapi('ProjectList');

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsInput = z.infer<typeof listProjectsQuerySchema>;
export type ProjectDto = z.infer<typeof projectSchema>;
export type ProjectSummaryDto = z.infer<typeof projectSummarySchema>;
export type ProjectListDto = z.infer<typeof projectListSchema>;
