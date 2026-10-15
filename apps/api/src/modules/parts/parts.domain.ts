// Business rules for parts (CU02). Pure functions: no Express, Mongoose or Zod here.
import type { Material } from '../../shared/catalog/materials.js';

/** Bounding box in whole millimetres. */
export interface Dimensions {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What a client sends: no `analyzedAt`, the server adds it (ADR 0013). */
export type SourceInput =
  | { readonly kind: 'manual' }
  | { readonly kind: 'gcode'; readonly fileName: string; readonly slicer: 'cura' };

/** What is stored: a G-code source also records when the part was saved with it. */
export type PartSource =
  | { readonly kind: 'manual' }
  | {
      readonly kind: 'gcode';
      readonly fileName: string;
      readonly slicer: 'cura';
      readonly analyzedAt: Date;
    };

/** The fields a user edits. `null` means "not set" for the two optional texts. */
export interface PartFields {
  readonly name: string;
  readonly description: string | null;
  readonly material: Material;
  readonly dimensionsMm: Dimensions;
  readonly estimatedWeightGrams: number;
  readonly estimatedPrintSeconds: number;
  /** Micrometres: 200 is 0.2 mm. */
  readonly layerHeightUm: number;
  readonly suggestedPrinterName: string | null;
  readonly source: PartSource;
}

/** A stored part. `deletedAt` is null while it is live. */
export interface Part extends PartFields {
  readonly id: string;
  readonly version: number;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A partial edit. An absent key means "keep"; `null` clears an optional text. */
export interface PartPatch {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly material?: Material | undefined;
  readonly dimensionsMm?: Dimensions | undefined;
  readonly estimatedWeightGrams?: number | undefined;
  readonly estimatedPrintSeconds?: number | undefined;
  readonly layerHeightUm?: number | undefined;
  readonly suggestedPrinterName?: string | null | undefined;
  readonly source?: PartSource | undefined;
}

export const PART_SORTS = [
  'name',
  'createdAt',
  'estimatedWeightGrams',
  'estimatedPrintSeconds',
] as const;
export type PartSort = (typeof PART_SORTS)[number];

export interface PartListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly material?: Material | undefined;
  readonly sort: PartSort;
  readonly order: 'asc' | 'desc';
}

export interface PartPage {
  readonly items: readonly Part[];
  readonly total: number;
}

/** The server, never the client, says when a part was saved with a G-code source. */
export function stampSource(source: SourceInput, now: Date): PartSource {
  if (source.kind === 'manual') return { kind: 'manual' };
  return { kind: 'gcode', fileName: source.fileName, slicer: source.slicer, analyzedAt: now };
}
