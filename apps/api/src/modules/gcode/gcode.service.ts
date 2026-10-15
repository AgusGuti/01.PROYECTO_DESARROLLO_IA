// Use case: analyse a G-code head. Stateless: no repository, no clock, and it never logs the text.
import type { Material } from '../../shared/catalog/materials.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  gramsFromFilamentLength,
  parseCuraHeader,
  usableGrams,
  type Dimensions,
  type GcodeWarningCode,
} from './gcode.domain.js';

export interface GcodeAnalysis {
  readonly slicer: 'cura';
  readonly estimatedPrintSeconds: number;
  readonly filamentMm: number;
  readonly filamentGrams: number | null;
  readonly layerHeightUm: number | null;
  readonly dimensionsMm: Dimensions | null;
  readonly targetMachineName: string | null;
  readonly warnings: readonly GcodeWarningCode[];
}

export interface AnalyzeInput {
  readonly head: string;
  readonly material?: Material | undefined;
}

export interface GcodeService {
  analyze(input: AnalyzeInput): GcodeAnalysis;
}

// Fixed messages: they never contain text from the file.
const issueOn = (message: string): AppError =>
  new AppError('validation_failed', 'The request is not valid.', {
    issues: [{ path: 'head', message }],
  });

export function createGcodeService(): GcodeService {
  return {
    analyze({ head, material }) {
      const parsed = parseCuraHeader(head);
      if (parsed.status === 'unsupported') throw issueOn('Not a supported Cura header.');
      if (parsed.status === 'unusable') {
        throw issueOn('The header has no usable time or filament length.');
      }
      const { header } = parsed;

      const warnings: GcodeWarningCode[] = [];
      let filamentGrams: number | null = null;
      if (material === undefined) {
        warnings.push('MATERIAL_NOT_SELECTED');
      } else {
        filamentGrams = usableGrams(gramsFromFilamentLength(header.filamentMm, material));
        warnings.push(filamentGrams === null ? 'WEIGHT_OUT_OF_RANGE' : 'GRAMS_FROM_DENSITY_TABLE');
      }
      if (header.layerHeightUm === null) warnings.push('LAYER_HEIGHT_UNAVAILABLE');
      warnings.push(
        header.dimensionsMm === null
          ? 'DIMENSIONS_UNAVAILABLE'
          : 'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM',
      );
      if (header.extrudersUsed > 1) warnings.push('MULTIPLE_EXTRUDERS_SUMMED');

      return {
        slicer: 'cura',
        estimatedPrintSeconds: header.estimatedPrintSeconds,
        filamentMm: header.filamentMm,
        filamentGrams,
        layerHeightUm: header.layerHeightUm,
        dimensionsMm: header.dimensionsMm,
        targetMachineName: header.targetMachineName,
        warnings,
      };
    },
  };
}
