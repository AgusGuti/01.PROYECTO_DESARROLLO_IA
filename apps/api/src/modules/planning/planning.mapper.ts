// Internal model -> response DTO. Fields are copied one by one, so nothing leaks by accident.
import type { PlanningSettings } from './planning.domain.js';
import type { PlanningSettingsDto } from './planning.schemas.js';

export function toPlanningSettingsDto(settings: PlanningSettings): PlanningSettingsDto {
  return {
    batchSavingBasisPoints: settings.batchSavingBasisPoints,
    version: settings.version,
    updatedAt: settings.updatedAt === null ? null : settings.updatedAt.toISOString(),
  };
}
