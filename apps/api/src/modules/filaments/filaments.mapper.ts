// Internal filament -> response DTO. Fields are copied one by one, so a field added to the
// internal model later (such as `deletedAt`) cannot leak into the API by accident.
import type { Filament, FilamentPage } from './filaments.domain.js';
import type { FilamentDto, FilamentListDto } from './filaments.schemas.js';

export function toFilamentDto(filament: Filament): FilamentDto {
  return {
    id: filament.id,
    brand: filament.brand,
    material: filament.material,
    colorName: filament.colorName,
    initialGrams: filament.initialGrams,
    availableGrams: filament.availableGrams,
    purchaseCostMinor: filament.purchaseCostMinor,
    // A calendar day: the first 10 characters of the UTC-midnight instant (ADR 0011).
    purchaseDate: filament.purchaseDate.toISOString().slice(0, 10),
    version: filament.version,
    createdAt: filament.createdAt.toISOString(),
    updatedAt: filament.updatedAt.toISOString(),
  };
}

export function toFilamentListDto(
  result: FilamentPage,
  paging: { page: number; pageSize: number },
): FilamentListDto {
  return {
    items: result.items.map(toFilamentDto),
    page: paging.page,
    pageSize: paging.pageSize,
    total: result.total,
  };
}
