// Business rules for printers (CU06). Pure functions: no Express, Mongoose or Zod here.
import { isReinforcedMaterial, type Material } from '../../shared/catalog/materials.js';

export const NOZZLE_DIAMETERS_MM = [0.2, 0.25, 0.4, 0.6, 0.8, 1] as const;
export type NozzleDiameterMm = (typeof NOZZLE_DIAMETERS_MM)[number];

export const NOZZLE_MATERIALS = ['brass', 'hardened_steel', 'stainless_steel'] as const;
export type NozzleMaterial = (typeof NOZZLE_MATERIALS)[number];

export const PRINTER_STATUSES = ['available', 'in_use', 'maintenance'] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

export interface BuildVolume {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Nozzle {
  readonly diameterMm: NozzleDiameterMm;
  readonly material: NozzleMaterial;
}

/** The fields a user edits. */
export interface PrinterFields {
  readonly name: string;
  readonly buildVolume: BuildVolume;
  readonly nozzle: Nozzle;
  readonly compatibleMaterials: readonly Material[];
  readonly typicalSpeedMmS: number | null;
  /** Average power while printing, in watts (ADR 0022); null when unknown. */
  readonly powerWatts: number | null;
  readonly status: PrinterStatus;
}

/** A stored printer. `archivedAt` and `deletedAt` are null while the printer is live. */
export interface Printer extends PrinterFields {
  readonly id: string;
  readonly version: number;
  readonly archivedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A partial edit. An absent key means "keep"; `typicalSpeedMmS: null` means "clear". */
export interface PrinterPatch {
  readonly name?: string | undefined;
  readonly buildVolume?: BuildVolume | undefined;
  readonly nozzle?: Nozzle | undefined;
  readonly compatibleMaterials?: readonly Material[] | undefined;
  readonly typicalSpeedMmS?: number | null | undefined;
  readonly powerWatts?: number | null | undefined;
  readonly status?: PrinterStatus | undefined;
}

export interface PrinterListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly status?: PrinterStatus | undefined;
  readonly sort: 'name' | 'createdAt';
  readonly order: 'asc' | 'desc';
}

export interface PrinterPage {
  readonly items: readonly Printer[];
  readonly total: number;
}

/**
 * Rule: a reinforced material (carbon or glass fibre) needs a hardened-steel nozzle.
 * @returns the offending materials; empty when the combination is allowed.
 */
export function materialsNeedingHardenedNozzle(
  fields: Pick<PrinterFields, 'nozzle' | 'compatibleMaterials'>,
): readonly Material[] {
  if (fields.nozzle.material === 'hardened_steel') return [];
  return fields.compatibleMaterials.filter((material) => isReinforcedMaterial(material));
}

/** The state a PATCH would produce. The rules must be checked on this, not on the patch alone. */
export function mergePrinter(current: PrinterFields, patch: PrinterPatch): PrinterFields {
  return {
    name: patch.name ?? current.name,
    buildVolume: patch.buildVolume ?? current.buildVolume,
    nozzle: patch.nozzle ?? current.nozzle,
    compatibleMaterials: patch.compatibleMaterials ?? current.compatibleMaterials,
    typicalSpeedMmS:
      patch.typicalSpeedMmS === undefined ? current.typicalSpeedMmS : patch.typicalSpeedMmS,
    powerWatts: patch.powerWatts === undefined ? current.powerWatts : patch.powerWatts,
    status: patch.status ?? current.status,
  };
}

export function isArchived(printer: Pick<Printer, 'archivedAt'>): boolean {
  return printer.archivedAt !== null;
}
