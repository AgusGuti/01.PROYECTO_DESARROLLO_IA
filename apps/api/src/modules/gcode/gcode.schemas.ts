// Zod schemas for the G-code analysis API (ADR 0014). The request is strict: the file name is
// not part of it, because the analyser does not use it.
import { materialSchema } from '../../shared/catalog/materials.schemas.js';
import { z } from '../../shared/http/zod.js';
import { GCODE_WARNING_CODES, MAX_HEAD_CHARACTERS } from './gcode.domain.js';

export const analyzeGcodeSchema = z
  .strictObject({
    head: z
      .string()
      .min(1)
      .max(MAX_HEAD_CHARACTERS)
      .openapi({
        description:
          'The first 65536 characters of the .gcode file, exactly as read (not trimmed). It is ' +
          'never stored or logged.',
      }),
    material: materialSchema.optional().openapi({
      description: 'Needed to estimate the weight in grams.',
    }),
  })
  .openapi('AnalyzeGcodeRequest');

// A named enum, so the web can type a `Record` over it and a new code breaks its build.
export const gcodeWarningCodeSchema = z.enum(GCODE_WARNING_CODES).openapi('GcodeWarningCode');

const gcodeDimensionsSchema = z
  .object({ x: z.number().int(), y: z.number().int(), z: z.number().int() })
  .openapi({
    description: 'Bounding box in whole millimetres, rounded up. Includes skirt and brim.',
  });

export const gcodeAnalysisSchema = z
  .object({
    slicer: z.literal('cura'),
    estimatedPrintSeconds: z.number().int(),
    filamentMm: z.number().int().openapi({ description: 'Filament length, all extruders.' }),
    filamentGrams: z.number().int().nullable().openapi({
      description: 'Estimated from a density table (ADR 0015). Null without a material.',
    }),
    layerHeightUm: z.number().int().nullable(),
    dimensionsMm: gcodeDimensionsSchema.nullable(),
    targetMachineName: z.string().nullable().openapi({
      description: 'The slicer machine name, kept only if it is printable ASCII.',
    }),
    warnings: z.array(z.object({ code: gcodeWarningCodeSchema })),
  })
  .openapi('GcodeAnalysis');

export type AnalyzeGcodeInput = z.infer<typeof analyzeGcodeSchema>;
export type GcodeAnalysisDto = z.infer<typeof gcodeAnalysisSchema>;
