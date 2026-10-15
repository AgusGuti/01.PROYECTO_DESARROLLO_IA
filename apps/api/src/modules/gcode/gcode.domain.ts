// Business rules for reading a Cura G-code header (CU02, ADR 0014 and 0015). Pure functions: no
// framework, no clock, no I/O. The text is hostile, so every limit below is deliberate and every
// number goes through a digit-only pattern and a range check before it is used.
import {
  FILAMENT_DENSITY_G_CM3,
  FILAMENT_DIAMETER_MM,
  type Material,
} from '../../shared/catalog/materials.js';

export const GCODE_WARNING_CODES = [
  'GRAMS_FROM_DENSITY_TABLE',
  'MATERIAL_NOT_SELECTED',
  'WEIGHT_OUT_OF_RANGE',
  'LAYER_HEIGHT_UNAVAILABLE',
  'DIMENSIONS_UNAVAILABLE',
  'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM',
  'MULTIPLE_EXTRUDERS_SUMMED',
] as const;
export type GcodeWarningCode = (typeof GCODE_WARNING_CODES)[number];

/** At most this many characters, lines and characters per line are looked at. */
export const MAX_HEAD_CHARACTERS = 65_536;
const MAX_LINES = 2000;
const MAX_LINE_CHARACTERS = 500;

const MAX_PRINT_SECONDS = 2_592_000;
const MAX_FILAMENT_MM = 100_000_000;
const MAX_COORDINATE_UM = 1_000_000;
const MAX_SIDE_MM = 1000;
const MAX_GRAMS = 20_000;

export interface Dimensions {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CuraHeader {
  readonly estimatedPrintSeconds: number;
  /** All extruders added together, in whole millimetres. */
  readonly filamentMm: number;
  /** Extruders that actually pushed filament. */
  readonly extrudersUsed: number;
  readonly layerHeightUm: number | null;
  readonly dimensionsMm: Dimensions | null;
  readonly targetMachineName: string | null;
}

/** `unsupported`: not a Cura Marlin/RepRap header. `unusable`: Cura, but no time or filament. */
export type CuraParseResult =
  | { readonly status: 'ok'; readonly header: CuraHeader }
  | { readonly status: 'unsupported' }
  | { readonly status: 'unusable' };

const PREFIXES = {
  flavor: ';FLAVOR:',
  time: ';TIME:',
  filament: ';Filament used:',
  layerHeight: ';Layer height:',
  minX: ';MINX:',
  minY: ';MINY:',
  maxX: ';MAXX:',
  maxY: ';MAXY:',
  maxZ: ';MAXZ:',
  machine: ';TARGET_MACHINE.NAME:',
} as const;
type Key = keyof typeof PREFIXES;
const KEYS = Object.keys(PREFIXES) as Key[];

const GENERATED_PREFIX = ';Generated with Cura_SteamEngine ';
const SUPPORTED_FLAVORS: ReadonlySet<string> = new Set(['Marlin', 'RepRap']);

// Anchored, with bounded quantifiers and no nested repetition: linear time on any input.
const SECONDS = /^\d{1,9}$/;
const LENGTHS = /^\d{1,6}(?:\.\d{1,6})?m(?:, ?\d{1,6}(?:\.\d{1,6})?m){0,7}$/;
const LAYER_HEIGHT = /^\d{1,2}(?:\.\d{1,6})?$/;
const COORDINATE = /^-?\d{1,5}(?:\.\d{1,6})?$/;
const MACHINE_NAME = /^[\x20-\x7e]{1,100}$/;

/**
 * Converts a plain decimal such as "12.4821" to thousandths (12482) with integer arithmetic,
 * rounding half up. Floats are never used for the decimal part, so "100.3" stays exact.
 */
function toThousandths(decimal: string): number {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.slice(negative ? 1 : 0).split('.');
  const magnitude = Number(whole) * 1000 + Math.round(Number(fraction.padEnd(6, '0')) / 1000);
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

function parseSeconds(raw: string | undefined): number | null {
  if (raw === undefined || !SECONDS.test(raw)) return null;
  const seconds = Number(raw);
  return seconds >= 1 && seconds <= MAX_PRINT_SECONDS ? seconds : null;
}

function parseFilament(raw: string | undefined): { mm: number; used: number } | null {
  if (raw === undefined || !LENGTHS.test(raw)) return null;
  let mm = 0;
  let used = 0;
  for (const part of raw.split(',')) {
    // Metres to millimetres: the thousandths of a metre.
    const value = toThousandths(part.trim().slice(0, -1));
    mm += value;
    if (value > 0) used += 1;
  }
  return mm >= 1 && mm <= MAX_FILAMENT_MM ? { mm, used } : null;
}

function parseLayerHeightUm(raw: string | undefined): number | null {
  if (raw === undefined || !LAYER_HEIGHT.test(raw)) return null;
  const um = toThousandths(raw);
  return um >= 10 && um <= 2000 ? um : null;
}

/** A coordinate in whole micrometres, or null when it is not a plain number in range. */
function parseCoordinateUm(raw: string | undefined): number | null {
  if (raw === undefined || !COORDINATE.test(raw)) return null;
  const um = toThousandths(raw);
  return Math.abs(um) <= MAX_COORDINATE_UM ? um : null;
}

function computeDimensions(raw: ReadonlyMap<Key, string>): Dimensions | null {
  const minX = parseCoordinateUm(raw.get('minX'));
  const maxX = parseCoordinateUm(raw.get('maxX'));
  const minY = parseCoordinateUm(raw.get('minY'));
  const maxY = parseCoordinateUm(raw.get('maxY'));
  const maxZ = parseCoordinateUm(raw.get('maxZ'));
  if (minX === null || maxX === null || minY === null || maxY === null || maxZ === null) {
    return null;
  }
  // Integer micrometres, rounded up to whole millimetres: the part is never reported smaller.
  // MINZ is the first layer height, not the bottom of the part, so z is just MAXZ.
  const x = Math.ceil((maxX - minX) / 1000);
  const y = Math.ceil((maxY - minY) / 1000);
  const z = Math.ceil(maxZ / 1000);
  const fits = (side: number): boolean => side >= 1 && side <= MAX_SIDE_MM;
  return fits(x) && fits(y) && fits(z) ? { x, y, z } : null;
}

/** Printable ASCII, 1..100 characters; anything else is dropped. */
function parseMachineName(raw: string | undefined): string | null {
  return raw !== undefined && MACHINE_NAME.test(raw) ? raw : null;
}

/** The first occurrence of each known key in the leading comment block, and whether it is Cura. */
function readCommentBlock(head: string): { raw: Map<Key, string>; generated: boolean } {
  const text = head.length > MAX_HEAD_CHARACTERS ? head.slice(0, MAX_HEAD_CHARACTERS) : head;
  const raw = new Map<Key, string>();
  let generated = false;
  let position = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (let lines = 0; position < text.length && lines < MAX_LINES; lines += 1) {
    const newline = text.indexOf('\n', position);
    const next = newline === -1 ? text.length : newline + 1;
    let end = newline === -1 ? text.length : newline;
    if (end > position && text.charCodeAt(end - 1) === 13) end -= 1;

    if (end > position) {
      // The comment block ends at the first line that is not a comment.
      if (text.charCodeAt(position) !== 59) break;
      if (end - position <= MAX_LINE_CHARACTERS) {
        const line = text.slice(position, end);
        if (line.startsWith(GENERATED_PREFIX)) generated = true;
        const key = KEYS.find((candidate) => line.startsWith(PREFIXES[candidate]));
        // The first occurrence wins: a later duplicate cannot override an honest value.
        if (key !== undefined && !raw.has(key)) {
          // Cura writes "; Layer height: 0.2" with a space after the colon.
          raw.set(key, line.slice(PREFIXES[key].length).trim());
        }
      }
    }
    position = next;
  }
  return { raw, generated };
}

/**
 * Reads what Cura writes in the first comment lines of a G-code file.
 * Never throws and never returns NaN or Infinity.
 */
export function parseCuraHeader(head: string): CuraParseResult {
  const { raw, generated } = readCommentBlock(head);
  const flavor = raw.get('flavor');
  if (!generated || flavor === undefined || !SUPPORTED_FLAVORS.has(flavor)) {
    return { status: 'unsupported' };
  }

  const seconds = parseSeconds(raw.get('time'));
  const filament = parseFilament(raw.get('filament'));
  if (seconds === null || filament === null) return { status: 'unusable' };

  return {
    status: 'ok',
    header: {
      estimatedPrintSeconds: seconds,
      filamentMm: filament.mm,
      extrudersUsed: filament.used,
      layerHeightUm: parseLayerHeightUm(raw.get('layerHeight')),
      dimensionsMm: computeDimensions(raw),
      targetMachineName: parseMachineName(raw.get('machine')),
    },
  };
}

/** Estimated grams: round(length x filament cross-section x density), ADR 0015. */
export function gramsFromFilamentLength(filamentMm: number, material: Material): number {
  const crossSectionMm2 = Math.PI * (FILAMENT_DIAMETER_MM / 2) ** 2;
  return Math.round((filamentMm * crossSectionMm2 * FILAMENT_DENSITY_G_CM3[material]) / 1000);
}

/** The grams to offer, or null when the number would not be a valid part weight. */
export function usableGrams(grams: number): number | null {
  return grams >= 1 && grams <= MAX_GRAMS ? grams : null;
}
