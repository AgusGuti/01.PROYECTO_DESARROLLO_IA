// Zod schemas for the costs API: the source of the OpenAPI contract (standard §7.1).
// Every input object is strict and integer-only, so a float or an unknown key is a 400.
import { z } from '../../shared/http/zod.js';
import { COST_WARNING_CODES } from './costs.domain.js';

const objectId = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Must be a 24-character hexadecimal id.')
  .openapi({ example: '66f0c0ffee0123456789abcd' });

const moneyMinor = z.number().int().min(0).max(1_000_000_000);
const basisPoints = z.number().int().min(0).max(100_000);

export const costWarningCodeSchema = z.enum(COST_WARNING_CODES).openapi('CostWarningCode');

export const costEstimateRequestSchema = z
  .strictObject({
    partId: objectId,
    filamentId: objectId,
    printerId: objectId.optional().openapi({
      description: 'Optional. Without a printer (or without its power) electricity is omitted.',
    }),
    quantity: z.number().int().min(1).max(1000).default(1),
    marginBasisPoints: basisPoints.optional().openapi({
      description:
        'Present means a sale: this margin (12.5 % is 1250) is added on the subtotal. ' +
        'Absent means no margin. The default margin of the settings is never applied here.',
    }),
  })
  .openapi('CostEstimateRequest');

export const updateCostSettingsSchema = z
  .strictObject({
    kwhPriceMinor: moneyMinor.openapi({ description: 'Price of one kWh, in centavos.' }),
    wearPerHourMinor: moneyMinor.openapi({ description: 'Machine wear per print hour, centavos.' }),
    fixedPerJobMinor: moneyMinor.openapi({ description: 'Fixed cost charged once per estimate.' }),
    defaultMarginBasisPoints: basisPoints.openapi({
      description: 'Value the form pre-fills for a sale. The API never applies it by itself.',
    }),
    version: z.number().int().min(0).openapi({
      description: '0 for the first save, otherwise the version last seen (ADR 0021).',
    }),
  })
  .openapi('UpdateCostSettingsRequest');

const timestamp = z.iso.datetime().openapi({ example: '2026-01-01T12:00:00.000Z' });

export const costSettingsSchema = z
  .object({
    kwhPriceMinor: z.number().int(),
    wearPerHourMinor: z.number().int(),
    fixedPerJobMinor: z.number().int(),
    defaultMarginBasisPoints: z.number().int(),
    version: z.number().int().openapi({ description: '0 until the settings are first saved.' }),
    updatedAt: timestamp.nullable(),
  })
  .openapi('CostSettings');

const centavos = (description: string) => z.number().int().openapi({ description });

export const costEstimateSchema = z
  .object({
    quantity: z.number().int(),
    printSeconds: z.number().int(),
    filament: z.object({
      grams: z.number().int(),
      costMinor: centavos('Centavos of ARS, rounded once.'),
    }),
    electricity: z
      .object({ watts: z.number().int(), costMinor: centavos('Centavos of ARS.') })
      .nullable()
      .openapi({ description: 'Null without a printer or without its power.' }),
    wear: z.object({ costMinor: centavos('Centavos of ARS.') }),
    fixed: z.object({ costMinor: centavos('Charged once per estimate.') }),
    subtotalMinor: centavos('Sum of the lines: the clean cost.'),
    marginBasisPoints: z.number().int(),
    marginMinor: centavos('Margin added on the subtotal; 0 when not a sale.'),
    totalMinor: centavos('subtotalMinor + marginMinor.'),
    unitTotalMinor: centavos('Average per unit; unit x quantity can differ by a few centavos.'),
    warnings: z.array(z.object({ code: costWarningCodeSchema })),
  })
  .openapi('CostEstimate');

export type CostEstimateRequestInput = z.infer<typeof costEstimateRequestSchema>;
export type UpdateCostSettingsInput = z.infer<typeof updateCostSettingsSchema>;
export type CostEstimateDto = z.infer<typeof costEstimateSchema>;
export type CostSettingsDto = z.infer<typeof costSettingsSchema>;
