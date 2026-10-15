// Zod schemas for the parts API: the source of the OpenAPI contract (standard §7.1).
// Every input object is strict, so an unknown key (including server-owned fields such as `id`,
// `version` on create, `deletedAt` or `source.analyzedAt`) is a 400 and can never reach a model.
import { materialSchema } from '../../shared/catalog/materials.schemas.js';
import { z } from '../../shared/http/zod.js';
import { PART_SORTS } from './parts.domain.js';

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

/** Same rules as `textSchema`, and `null` is allowed: it clears the field. */
const clearableTextSchema = (max: number, example: string) =>
  textSchema(max, example)
    .nullable()
    .openapi({ type: ['string', 'null'], minLength: 1, maxLength: max, example });

const nameSchema = textSchema(100, 'Soporte de estante en L');
const descriptionSchema = textSchema(1000, 'Soporte para estantes de 18 mm.');
const printerNameSchema = textSchema(100, 'Creality Ender-3 Pro');
const fileNameSchema = textSchema(255, 'soporte-celular.gcode');

const side = z.number().int().min(1).max(1000);

export const partDimensionsSchema = z
  .strictObject({ x: side, y: side, z: side })
  .openapi('PartDimensions', {
    description: 'Bounding box in whole millimetres. Replaced whole when edited.',
  });

const weightSchema = z.number().int().min(1).max(20_000).openapi({
  description: 'Estimated weight in grams.',
});
const printSecondsSchema = z.number().int().min(1).max(2_592_000).openapi({
  description: 'Estimated print time in seconds (up to 30 days).',
});
const layerHeightSchema = z.number().int().min(10).max(2000).openapi({
  description: 'Layer height in micrometres: 200 means 0.2 mm.',
});

// The two kinds are separate named objects. They are documented as a union with a discriminator,
// and the generated contract is checked for both variants (document.spec.ts).
const manualSourceSchema = z
  .strictObject({ kind: z.literal('manual') })
  .openapi('ManualPartSource');

const gcodeSourceInputSchema = z
  .strictObject({
    kind: z.literal('gcode'),
    fileName: fileNameSchema,
    slicer: z.literal('cura'),
  })
  .openapi('GcodePartSourceInput');

/** What a client sends. `analyzedAt` is not accepted: the server adds it from its clock. */
export const partSourceInputSchema = z
  .discriminatedUnion('kind', [manualSourceSchema, gcodeSourceInputSchema])
  .openapi('PartSourceInput');

export const createPartSchema = z
  .strictObject({
    name: nameSchema,
    description: descriptionSchema.optional(),
    material: materialSchema,
    dimensionsMm: partDimensionsSchema,
    estimatedWeightGrams: weightSchema,
    estimatedPrintSeconds: printSecondsSchema,
    layerHeightUm: layerHeightSchema,
    suggestedPrinterName: printerNameSchema.optional(),
    source: partSourceInputSchema
      .default({ kind: 'manual' })
      .openapi({ description: 'Defaults to {"kind":"manual"}.' }),
  })
  .openapi('CreatePartRequest');

/**
 * `version` is the version the client last saw (ADR 0008). `dimensionsMm` is replaced whole.
 * `null` clears `description` or `suggestedPrinterName`. A `source` is stamped again.
 */
export const updatePartSchema = z
  .strictObject({
    version: z.number().int().min(1),
    name: nameSchema.optional(),
    description: clearableTextSchema(1000, 'Soporte para estantes de 18 mm.').optional(),
    material: materialSchema.optional(),
    dimensionsMm: partDimensionsSchema.optional(),
    estimatedWeightGrams: weightSchema.optional(),
    estimatedPrintSeconds: printSecondsSchema.optional(),
    layerHeightUm: layerHeightSchema.optional(),
    suggestedPrinterName: clearableTextSchema(100, 'Creality Ender-3 Pro').optional(),
    source: partSourceInputSchema.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'Provide at least one field to change besides version.',
  })
  .openapi('UpdatePartRequest');

export const partIdParamsSchema = z.strictObject({
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

export const listPartsQuerySchema = z.strictObject({
  page: wholeNumber(1, 10_000, 1),
  pageSize: wholeNumber(1, 100, 20),
  material: materialSchema.optional(),
  sort: z.enum(PART_SORTS).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const timestamp = z.iso.datetime().openapi({ example: '2026-01-01T12:00:00.000Z' });

const gcodeSourceSchema = z
  .object({
    kind: z.literal('gcode'),
    fileName: z.string(),
    slicer: z.literal('cura'),
    analyzedAt: timestamp.openapi({
      description: 'When the part was saved with this source (set by the server).',
    }),
  })
  .openapi('GcodePartSource');

export const partSourceSchema = z
  .discriminatedUnion('kind', [manualSourceSchema, gcodeSourceSchema])
  .openapi('PartSource');

export const partSchema = z
  .object({
    id: z.string().openapi({ example: '66f0c0ffee0123456789abcd' }),
    name: z.string(),
    description: z.string().nullable(),
    material: materialSchema,
    dimensionsMm: partDimensionsSchema,
    estimatedWeightGrams: z.number().int(),
    estimatedPrintSeconds: z.number().int(),
    layerHeightUm: z.number().int().openapi({ description: 'Micrometres: 200 means 0.2 mm.' }),
    suggestedPrinterName: z.string().nullable(),
    source: partSourceSchema,
    version: z.number().int().openapi({ description: 'Send this back when editing.' }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi('Part');

export const partListSchema = z
  .object({
    items: z.array(partSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .openapi('PartList');

export type CreatePartInput = z.infer<typeof createPartSchema>;
export type UpdatePartInput = z.infer<typeof updatePartSchema>;
export type ListPartsInput = z.infer<typeof listPartsQuerySchema>;
export type PartDto = z.infer<typeof partSchema>;
export type PartListDto = z.infer<typeof partListSchema>;
