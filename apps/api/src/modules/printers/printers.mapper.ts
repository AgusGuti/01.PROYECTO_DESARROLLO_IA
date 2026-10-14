// Internal printer -> response DTO. Fields are copied one by one, so a field added to the
// internal model later (such as `deletedAt`) cannot leak into the API by accident.
import type { Printer, PrinterPage } from './printers.domain.js';
import type { PrinterDto, PrinterListDto } from './printers.schemas.js';

export function toPrinterDto(printer: Printer): PrinterDto {
  return {
    id: printer.id,
    name: printer.name,
    buildVolume: {
      x: printer.buildVolume.x,
      y: printer.buildVolume.y,
      z: printer.buildVolume.z,
    },
    nozzle: { diameterMm: printer.nozzle.diameterMm, material: printer.nozzle.material },
    compatibleMaterials: [...printer.compatibleMaterials],
    typicalSpeedMmS: printer.typicalSpeedMmS,
    status: printer.status,
    version: printer.version,
    archivedAt: printer.archivedAt === null ? null : printer.archivedAt.toISOString(),
    createdAt: printer.createdAt.toISOString(),
    updatedAt: printer.updatedAt.toISOString(),
  };
}

export function toPrinterListDto(
  result: PrinterPage,
  paging: { page: number; pageSize: number },
): PrinterListDto {
  return {
    items: result.items.map(toPrinterDto),
    page: paging.page,
    pageSize: paging.pageSize,
    total: result.total,
  };
}
