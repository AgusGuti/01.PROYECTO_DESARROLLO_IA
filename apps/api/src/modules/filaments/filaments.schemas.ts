// Zod schemas for the filaments API: the source of the OpenAPI contract (standard §7.1).
// Every input object is strict, so an unknown key (including server-owned fields such as `id`,
// `version` on create, `deletedAt` or a `currency`) is a 400 and can never reach a model.
import { materialSchema } from '../../shared/catalog/materials.schemas.js';
import { z } from '../../shared/http/zod.js';
import { FILAMENT_SORTS } from './filaments.domain.js';

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

const brandSchema = textSchema(60, 'Grilon3');
const colorNameSchema = textSchema(40, 'Negro');

const initialGramsSchema = z
  .number()
  .int()
  .min(1)
  .max(20_000)
  .openapi({ description: 'Weight of the spool when bought, in grams.' });

const availableGramsSchema = z
  .number()
  .int()
  .min(0)
  .max(20_000)
  .openapi({ description: 'Grams left on the spool. Never more than initialGrams.' });

const purchaseCostMinorSchema = z.number().int().min(0).max(1_000_000_000).openapi({
  description:
    'Purchase cost in centavos of Argentine pesos (ARS), an integer. 1500000 means $15.000,00.',
});

const DATE_DESCRIPTION =
  'Calendar day of the purchase, YYYY-MM-DD (UTC). It cannot be later than today (UTC).';

// A real calendar date, stored as a UTC-midnight Date (ADR 0011).
const purchaseDateSchema = z.iso
  .date()
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .openapi({
    type: 'string',
    format: 'date',
    example: '2026-03-15',
    description: DATE_DESCRIPTION,
  });

export const createFilamentSchema = z
  .strictObject({
    brand: brandSchema,
    material: materialSchema,
    colorName: colorNameSchema,
    initialGrams: initialGramsSchema,
    availableGrams: availableGramsSchema
      .optional()
      .openapi({ description: 'Defaults to initialGrams (a new, unused spool).' }),
    purchaseCostMinor: purchaseCostMinorSchema,
    purchaseDate: purchaseDateSchema,
  })
  .openapi('CreateFilamentRequest');

/** `version` is the version the client last saw (ADR 0008). */
export const updateFilamentSchema = z
  .strictObject({
    version: z.number().int().min(1),
    brand: brandSchema.optional(),
    material: materialSchema.optional(),
    colorName: colorNameSchema.optional(),
    initialGrams: initialGramsSchema.optional(),
    availableGrams: availableGramsSchema.optional(),
    purchaseCostMinor: purchaseCostMinorSchema.optional(),
    purchaseDate: purchaseDateSchema.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'Provide at least one field to change besides version.',
  })
  .openapi('UpdateFilamentRequest');

export const consumeFilamentSchema = z
  .strictObject({
    grams: z
      .number()
      .int()
      .min(1)
      .max(20_000)
      .openapi({ description: 'Grams to take from the spool.' }),
  })
  .openapi('ConsumeFilamentRequest');

export const filamentIdParamsSchema = z.strictObject({
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

export const listFilamentsQuerySchema = z.strictObject({
  page: wholeNumber(1, 10_000, 1),
  pageSize: wholeNumber(1, 100, 20),
  material: materialSchema.optional(),
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .openapi({
      type: 'string',
      enum: ['true', 'false'],
      description: 'true: only spools with grams left. false: only empty spools.',
    })
    .optional(),
  sort: z.enum(FILAMENT_SORTS).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const timestamp = z.iso.datetime().openapi({ example: '2026-01-01T12:00:00.000Z' });

export const filamentSchema = z
  .object({
    id: z.string().openapi({ example: '66f0c0ffee0123456789abcd' }),
    brand: z.string(),
    material: materialSchema,
    colorName: z.string(),
    initialGrams: z.number().int(),
    availableGrams: z.number().int(),
    purchaseCostMinor: z.number().int().openapi({
      description: 'Centavos of ARS. 1500000 means $15.000,00.',
    }),
    purchaseDate: z.string().openapi({
      type: 'string',
      format: 'date',
      example: '2026-03-15',
      description: 'YYYY-MM-DD, a calendar day (no time zone).',
    }),
    version: z.number().int().openapi({ description: 'Send this back when editing.' }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi('Filament');

export const filamentListSchema = z
  .object({
    items: z.array(filamentSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .openapi('FilamentList');

export type CreateFilamentInput = z.infer<typeof createFilamentSchema>;
export type UpdateFilamentInput = z.infer<typeof updateFilamentSchema>;
export type ConsumeFilamentInput = z.infer<typeof consumeFilamentSchema>;
export type ListFilamentsInput = z.infer<typeof listFilamentsQuerySchema>;
export type FilamentDto = z.infer<typeof filamentSchema>;
export type FilamentListDto = z.infer<typeof filamentListSchema>;
