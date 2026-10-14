// Zod schemas for the printers API: the source of the OpenAPI contract (standard §7.1).
// Every input object is strict, so an unknown key (including server-owned fields such as
// `version` on create, or `archivedAt`) is a 400 and can never reach a model or a filter.
import { MATERIALS } from '../../shared/catalog/materials.js';
import { materialSchema } from '../../shared/catalog/materials.schemas.js';
import { z } from '../../shared/http/zod.js';
import { NOZZLE_MATERIALS, PRINTER_STATUSES } from './printers.domain.js';

const CONTROL_CHARACTER = /\p{Cc}/u;
// Unicode code points, not UTF-16 units: an emoji counts as one character.
const codePoints = (value: string): number => Array.from(value).length;

/** Trimmed, NFC-normalised, 1..100 code points, no control characters (newline, NUL...). */
const nameSchema = z
  .string()
  // Checked on the raw text, so "abc\n" is rejected instead of silently trimmed.
  .refine((value) => !CONTROL_CHARACTER.test(value), 'Must not contain control characters.')
  .transform((value) => value.trim().normalize('NFC'))
  .refine((value) => codePoints(value) >= 1, 'Must not be empty.')
  .refine((value) => codePoints(value) <= 100, 'Must be at most 100 characters.')
  .openapi({ type: 'string', minLength: 1, maxLength: 100, example: 'Ender 3 Pro' });

const dimensionMm = z.number().int().min(1).max(2000);

const buildVolumeSchema = z
  .strictObject({ x: dimensionMm, y: dimensionMm, z: dimensionMm })
  .openapi('PrinterBuildVolume', { description: 'Usable print volume in millimetres.' });

const nozzleSchema = z
  .strictObject({
    // A union of literals, not `z.literal([...])`: the OpenAPI generator documents only the first
    // value of the latter, so the contract would list a single diameter.
    diameterMm: z.union([
      z.literal(0.2),
      z.literal(0.25),
      z.literal(0.4),
      z.literal(0.6),
      z.literal(0.8),
      z.literal(1),
    ]),
    material: z.enum(NOZZLE_MATERIALS),
  })
  .openapi('PrinterNozzle');

const compatibleMaterialsSchema = z
  .array(materialSchema)
  .min(1)
  .max(MATERIALS.length)
  .refine((list) => new Set(list).size === list.length, 'Must not contain duplicates.');

const typicalSpeedSchema = z.number().int().min(1).max(1000);
const statusSchema = z.enum(PRINTER_STATUSES).openapi('PrinterStatus');

const editableFields = {
  name: nameSchema,
  buildVolume: buildVolumeSchema,
  nozzle: nozzleSchema,
  compatibleMaterials: compatibleMaterialsSchema,
  status: statusSchema,
};

export const createPrinterSchema = z
  .strictObject({
    ...editableFields,
    typicalSpeedMmS: typicalSpeedSchema.optional(),
    status: statusSchema.default('available'),
    // Not stored: only says the client agrees to reuse a deleted printer that has this name.
    restoreIfDeleted: z
      .boolean()
      .default(false)
      .openapi({
        description:
          'Set to true to restore a deleted printer that holds this name, replacing its data ' +
          'with the submitted data. Without it, that name answers 409 (issue path "restoreIfDeleted").',
      }),
  })
  .openapi('CreatePrinterRequest');

/**
 * Nested objects and `compatibleMaterials` are replaced whole. `typicalSpeedMmS: null` clears it.
 * `version` is the version the client last saw (ADR 0008).
 */
export const updatePrinterSchema = z
  .strictObject({
    version: z.number().int().min(1),
    name: editableFields.name.optional(),
    buildVolume: editableFields.buildVolume.optional(),
    nozzle: editableFields.nozzle.optional(),
    compatibleMaterials: editableFields.compatibleMaterials.optional(),
    typicalSpeedMmS: typicalSpeedSchema.nullable().optional(),
    status: editableFields.status.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), {
    message: 'Provide at least one field to change besides version.',
  })
  .openapi('UpdatePrinterRequest');

export const printerIdParamsSchema = z.strictObject({
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

export const listPrintersQuerySchema = z.strictObject({
  page: wholeNumber(1, 10_000, 1),
  pageSize: wholeNumber(1, 100, 20),
  status: z.enum(PRINTER_STATUSES).optional(),
  sort: z.enum(['name', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const timestamp = z.iso.datetime().openapi({ example: '2026-01-01T12:00:00.000Z' });

export const printerSchema = z
  .object({
    id: z.string().openapi({ example: '66f0c0ffee0123456789abcd' }),
    name: z.string(),
    buildVolume: buildVolumeSchema,
    nozzle: nozzleSchema,
    compatibleMaterials: z.array(materialSchema),
    typicalSpeedMmS: z.number().int().nullable(),
    status: statusSchema,
    version: z.number().int().openapi({ description: 'Send this back when editing.' }),
    archivedAt: timestamp.nullable().openapi({
      description: 'Set while the printer waits to be removed ("Pendiente de eliminar").',
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .openapi('Printer');

export const printerListSchema = z
  .object({
    items: z.array(printerSchema),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  })
  .openapi('PrinterList');

export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;
export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;
export type ListPrintersInput = z.infer<typeof listPrintersQuerySchema>;
export type PrinterDto = z.infer<typeof printerSchema>;
export type PrinterListDto = z.infer<typeof printerListSchema>;
