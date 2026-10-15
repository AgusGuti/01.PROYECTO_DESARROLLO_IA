// Internal model -> response DTO. Fields are copied one by one, so nothing leaks by accident.
import type { CostSettings, Estimate, ProjectEstimate } from './costs.domain.js';
import type { CostEstimateDto, CostSettingsDto, ProjectCostEstimateDto } from './costs.schemas.js';

export function toCostEstimateDto(estimate: Estimate): CostEstimateDto {
  return {
    quantity: estimate.quantity,
    printSeconds: estimate.printSeconds,
    filament: { grams: estimate.filament.grams, costMinor: estimate.filament.costMinor },
    electricity:
      estimate.electricity === null
        ? null
        : { watts: estimate.electricity.watts, costMinor: estimate.electricity.costMinor },
    wear: { costMinor: estimate.wear.costMinor },
    fixed: { costMinor: estimate.fixed.costMinor },
    subtotalMinor: estimate.subtotalMinor,
    marginBasisPoints: estimate.marginBasisPoints,
    marginMinor: estimate.marginMinor,
    totalMinor: estimate.totalMinor,
    unitTotalMinor: estimate.unitTotalMinor,
    warnings: estimate.warnings.map((code) => ({ code })),
  };
}

export function toCostSettingsDto(settings: CostSettings): CostSettingsDto {
  return {
    kwhPriceMinor: settings.kwhPriceMinor,
    wearPerHourMinor: settings.wearPerHourMinor,
    fixedPerJobMinor: settings.fixedPerJobMinor,
    defaultMarginBasisPoints: settings.defaultMarginBasisPoints,
    version: settings.version,
    updatedAt: settings.updatedAt === null ? null : settings.updatedAt.toISOString(),
  };
}

export function toProjectCostEstimateDto(estimate: ProjectEstimate): ProjectCostEstimateDto {
  return {
    lines: estimate.lines.map((line) => ({
      partId: line.partId,
      quantity: line.quantity,
      printSeconds: line.printSeconds,
      filament: { grams: line.filament.grams, costMinor: line.filament.costMinor },
      electricity:
        line.electricity === null
          ? null
          : { watts: line.electricity.watts, costMinor: line.electricity.costMinor },
      wear: { costMinor: line.wear.costMinor },
      subtotalMinor: line.subtotalMinor,
      marginBasisPoints: line.marginBasisPoints,
      marginMinor: line.marginMinor,
      totalMinor: line.totalMinor,
      unitTotalMinor: line.unitTotalMinor,
      warnings: line.warnings.map((code) => ({ code })),
    })),
    fixed: { costMinor: estimate.fixed.costMinor },
    subtotalMinor: estimate.subtotalMinor,
    marginMinor: estimate.marginMinor,
    totalMinor: estimate.totalMinor,
    printSeconds: estimate.printSeconds,
    materials: estimate.materials.map(({ material, grams }) => ({ material, grams })),
    warnings: estimate.warnings.map((code) => ({ code })),
  };
}
