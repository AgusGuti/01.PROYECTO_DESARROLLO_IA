import type {
  CreatePartRequest,
  GcodeAnalysis,
  Material,
  Part,
  UpdatePartRequest,
} from '@print3d/api-contracts';

// Pure rules of the folder import. They mirror scripts/mcp/gcode-import-core.mjs on purpose, so
// the web screen and the MCP server agree on names, identity and what counts as a change (ADR 0034).

export const MAX_IMPORT_FILES = 1000;
const MAX_NAME_CODE_POINTS = 100;

export type SkipReason = 'no-dimensions' | 'no-weight' | 'no-layer-height' | 'no-print-time';

export const SKIP_LABELS: Readonly<Record<SkipReason, string>> = {
  'no-dimensions': 'El archivo no trae dimensiones.',
  'no-weight': 'No se pudo estimar el peso.',
  'no-layer-height': 'El archivo no trae la altura de capa.',
  'no-print-time': 'El archivo no trae el tiempo de impresión.',
};

export type ImportDecision =
  | { readonly action: 'create'; readonly body: CreatePartRequest }
  | { readonly action: 'update'; readonly id: string; readonly body: UpdatePartRequest }
  | { readonly action: 'unchanged' };

/** Path relative to the chosen folder, forward slashes: the first segment is the folder itself. */
export function relativeGcodePath(webkitRelativePath: string): string {
  return webkitRelativePath.split('/').slice(1).join('/');
}

export function isGcodePath(path: string): boolean {
  return path.toLowerCase().endsWith('.gcode');
}

/** "Bowden_square_cutter_0.4mm_3gr.gcode" becomes "Bowden square cutter 0.4mm 3gr". */
export function partName(relativePath: string): string {
  const base = (relativePath.split('/').pop() ?? '').replace(/\.gcode$/i, '');
  const spaced = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(spaced).slice(0, MAX_NAME_CODE_POINTS).join('');
}

/** The part for one analysed file, or why it cannot become one. */
export function toPart(
  relativePath: string,
  analysis: GcodeAnalysis,
  material: Material,
): { readonly part: CreatePartRequest } | { readonly skip: SkipReason } {
  const { dimensionsMm, filamentGrams, layerHeightUm, estimatedPrintSeconds } = analysis;
  if (dimensionsMm === null) return { skip: 'no-dimensions' };
  if (filamentGrams === null || filamentGrams < 1) return { skip: 'no-weight' };
  if (layerHeightUm === null) return { skip: 'no-layer-height' };
  if (estimatedPrintSeconds < 1) return { skip: 'no-print-time' };
  return {
    part: {
      name: partName(relativePath),
      material,
      dimensionsMm,
      estimatedWeightGrams: filamentGrams,
      estimatedPrintSeconds,
      layerHeightUm,
      source: { kind: 'gcode', fileName: relativePath, slicer: 'cura' },
    },
  };
}

/** An update changes the analysed data only: the name is kept, the user may have renamed it. */
export function decide(part: CreatePartRequest, existing: Part | undefined): ImportDecision {
  if (existing === undefined) return { action: 'create', body: part };
  const was = existing.dimensionsMm;
  const now = part.dimensionsMm;
  const same =
    existing.material === part.material &&
    existing.estimatedWeightGrams === part.estimatedWeightGrams &&
    existing.estimatedPrintSeconds === part.estimatedPrintSeconds &&
    existing.layerHeightUm === part.layerHeightUm &&
    was.x === now.x &&
    was.y === now.y &&
    was.z === now.z;
  if (same) return { action: 'unchanged' };
  return {
    action: 'update',
    id: existing.id,
    body: {
      version: existing.version,
      material: part.material,
      dimensionsMm: part.dimensionsMm,
      estimatedWeightGrams: part.estimatedWeightGrams,
      estimatedPrintSeconds: part.estimatedPrintSeconds,
      layerHeightUm: part.layerHeightUm,
      ...(part.source === undefined ? {} : { source: part.source }),
    },
  };
}
