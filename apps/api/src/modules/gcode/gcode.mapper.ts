// Internal analysis -> response DTO. Numbers and fixed codes only, plus the constrained machine name.
import type { GcodeAnalysisDto } from './gcode.schemas.js';
import type { GcodeAnalysis } from './gcode.service.js';

export function toGcodeAnalysisDto(analysis: GcodeAnalysis): GcodeAnalysisDto {
  return {
    slicer: analysis.slicer,
    estimatedPrintSeconds: analysis.estimatedPrintSeconds,
    filamentMm: analysis.filamentMm,
    filamentGrams: analysis.filamentGrams,
    layerHeightUm: analysis.layerHeightUm,
    dimensionsMm:
      analysis.dimensionsMm === null
        ? null
        : { x: analysis.dimensionsMm.x, y: analysis.dimensionsMm.y, z: analysis.dimensionsMm.z },
    targetMachineName: analysis.targetMachineName,
    warnings: analysis.warnings.map((code) => ({ code })),
  };
}
