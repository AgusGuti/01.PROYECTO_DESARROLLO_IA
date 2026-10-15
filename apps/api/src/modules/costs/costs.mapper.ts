// Internal model -> response DTO. Fields are copied one by one, so nothing leaks by accident.
import type { CostSettings, Estimate } from './costs.domain.js';
import type { CostEstimateDto, CostSettingsDto } from './costs.schemas.js';

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
