// Pure logic of the G-code import MCP server (no network, no MCP): which files to read, the part
// each one becomes, and whether it is a create, an update or nothing. Tested in
// gcode-import-core.test.mjs. The server in gcode-import-server.mjs does the I/O.
import { readdir } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';

/** The API analyses only this much of a file (ADR 0014). */
export const HEAD_CHARACTERS = 65_536;
export const MAX_FILES = 1000;
const MAX_NAME_CODE_POINTS = 100;

/**
 * Relative paths (forward slashes) of every .gcode under `root`, or under `root/folder`.
 * Symbolic links are skipped, and `folder` cannot leave `root`.
 */
export async function findGcodes(root, folder = '') {
  const start = resolve(root, folder);
  const inside = relative(resolve(root), start);
  if (inside.startsWith('..') || resolve(inside) === inside) {
    throw new Error('The folder must be inside the G-code root.');
  }
  const found = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gcode')) {
        found.push(relative(resolve(root), full).split(sep).join('/'));
      }
      if (found.length > MAX_FILES) throw new Error(`More than ${String(MAX_FILES)} files.`);
    }
  };
  await walk(start);
  return found.sort();
}

/** "Bowden_square_cutter_0.4mm_3gr_32m.gcode" -> "Bowden square cutter 0.4mm 3gr 32m". */
export function partName(relativePath) {
  const base = basename(relativePath).replace(/\.gcode$/i, '');
  const spaced = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(spaced).slice(0, MAX_NAME_CODE_POINTS).join('');
}

/** The part fields for one analysed file, or why it cannot become a part. */
export function toPart(relativePath, analysis, material) {
  const { dimensionsMm, filamentGrams, layerHeightUm, estimatedPrintSeconds } = analysis;
  if (dimensionsMm === null) return { skip: 'no-dimensions' };
  if (filamentGrams === null || filamentGrams < 1) return { skip: 'no-weight' };
  if (layerHeightUm === null) return { skip: 'no-layer-height' };
  if (estimatedPrintSeconds < 1) return { skip: 'no-print-time' };
  return {
    fields: {
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

const DATA_FIELDS = ['material', 'estimatedWeightGrams', 'estimatedPrintSeconds', 'layerHeightUm'];

/**
 * What to do with `fields` given the part already imported from the same file (or undefined).
 * An update changes the analysed data only: the name is kept, because the user may have renamed it.
 */
export function decide(fields, existing) {
  if (existing === undefined) return { action: 'create', body: fields };
  const d = existing.dimensionsMm;
  const n = fields.dimensionsMm;
  const same =
    DATA_FIELDS.every((key) => existing[key] === fields[key]) &&
    d.x === n.x &&
    d.y === n.y &&
    d.z === n.z;
  if (same) return { action: 'unchanged' };
  const body = { version: existing.version, ...fields };
  delete body.name;
  return { action: 'update', body };
}
