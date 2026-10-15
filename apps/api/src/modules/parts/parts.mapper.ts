// Internal part -> response DTO. Fields are copied one by one, so a field added to the internal
// model later (such as `deletedAt`) cannot leak into the API by accident.
import type { Part, PartPage, PartSource } from './parts.domain.js';
import type { PartDto, PartListDto } from './parts.schemas.js';

function toSourceDto(source: PartSource): PartDto['source'] {
  if (source.kind === 'manual') return { kind: 'manual' };
  return {
    kind: 'gcode',
    fileName: source.fileName,
    slicer: source.slicer,
    analyzedAt: source.analyzedAt.toISOString(),
  };
}

export function toPartDto(part: Part): PartDto {
  return {
    id: part.id,
    name: part.name,
    description: part.description,
    material: part.material,
    dimensionsMm: { x: part.dimensionsMm.x, y: part.dimensionsMm.y, z: part.dimensionsMm.z },
    estimatedWeightGrams: part.estimatedWeightGrams,
    estimatedPrintSeconds: part.estimatedPrintSeconds,
    layerHeightUm: part.layerHeightUm,
    suggestedPrinterName: part.suggestedPrinterName,
    source: toSourceDto(part.source),
    version: part.version,
    createdAt: part.createdAt.toISOString(),
    updatedAt: part.updatedAt.toISOString(),
  };
}

export function toPartListDto(
  result: PartPage,
  paging: { page: number; pageSize: number },
): PartListDto {
  return {
    items: result.items.map(toPartDto),
    page: paging.page,
    pageSize: paging.pageSize,
    total: result.total,
  };
}
