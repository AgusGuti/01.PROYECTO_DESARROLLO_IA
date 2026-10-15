import type { GcodeWarningCode, Material } from '@print3d/api-contracts';

// A `Record` over a contract type: when the API adds a material, the compiler fails here until
// it has a Spanish label (ADR 0007). Copied from the filaments feature on purpose: a feature
// never imports from another feature.
export const MATERIAL_LABELS: Readonly<Record<Material, string>> = {
  PLA: 'PLA',
  PETG: 'PETG',
  ABS: 'ABS',
  ASA: 'ASA',
  TPU: 'TPU',
  PA: 'Nailon (PA)',
  PC: 'Policarbonato (PC)',
  HIPS: 'HIPS',
  PVA: 'PVA',
  PP: 'PP',
  PLA_CF: 'PLA con fibra de carbono (PLA-CF)',
  PETG_CF: 'PETG con fibra de carbono (PETG-CF)',
  PA_CF: 'Nailon con fibra de carbono (PA-CF)',
  PA_GF: 'Nailon con fibra de vidrio (PA-GF)',
};

// Option order for the selects. Completeness is checked by a test against the label table.
export const MATERIAL_ORDER: readonly Material[] = [
  'PLA',
  'PETG',
  'ABS',
  'ASA',
  'TPU',
  'PA',
  'PC',
  'HIPS',
  'PVA',
  'PP',
  'PLA_CF',
  'PETG_CF',
  'PA_CF',
  'PA_GF',
];

export function isMaterial(value: unknown): value is Material {
  return typeof value === 'string' && Object.hasOwn(MATERIAL_LABELS, value);
}

// ---- G-code warnings (ADR 0014) --------------------------------------------------------------

// Typed from the contract: a new warning code breaks the build here until it has a label.
export const GCODE_WARNING_LABELS: Readonly<Record<GcodeWarningCode, string>> = {
  GRAMS_FROM_DENSITY_TABLE:
    'Los gramos son una estimación a partir de una tabla de densidades; pueden variar un poco según tu filamento.',
  MATERIAL_NOT_SELECTED:
    'No elegiste un material, así que no se pudieron estimar los gramos. Elegí el material y reimportá el archivo, o cargalos a mano.',
  WEIGHT_OUT_OF_RANGE:
    'El peso estimado queda fuera del rango permitido (hasta 20000 g). Cargalo a mano.',
  LAYER_HEIGHT_UNAVAILABLE: 'El archivo no indica la altura de capa. Cargala a mano.',
  DIMENSIONS_UNAVAILABLE: 'No se pudieron calcular las dimensiones. Cargalas a mano.',
  DIMENSIONS_INCLUDE_SKIRT_OR_BRIM:
    'Las dimensiones incluyen la falda (skirt) o el borde (brim), así que pueden ser algo mayores que la pieza.',
  MULTIPLE_EXTRUDERS_SUMMED:
    'El archivo usa varios extrusores: se sumó el filamento de todos para estimar el peso.',
};

export function isGcodeWarningCode(value: unknown): value is GcodeWarningCode {
  return typeof value === 'string' && Object.hasOwn(GCODE_WARNING_LABELS, value);
}

// ---- Duration --------------------------------------------------------------------------------

const pad2 = (value: number): string => String(value).padStart(2, '0');

export interface Hms {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/** 7380 becomes 2 h, 3 min, 0 s. */
export function secondsToHms(total: number): Hms {
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function hmsToSeconds(hours: number, minutes: number, seconds: number): number {
  return hours * 3600 + minutes * 60 + seconds;
}

/** "2 h 03 min"; under an hour "45 min"; under a minute "30 s". Seconds past the minute are dropped. */
export function formatDuration(totalSeconds: number): string {
  const { hours, minutes } = secondsToHms(totalSeconds);
  if (hours > 0) return `${String(hours)} h ${pad2(minutes)} min`;
  if (minutes > 0) return `${String(minutes)} min`;
  return `${String(totalSeconds)} s`;
}

// ---- Layer height (ADR 0013) -----------------------------------------------------------------

export const MIN_LAYER_UM = 10;
export const MAX_LAYER_UM = 2000;

const MM_INPUT = /^(\d{1,4})(?:,(\d{1,3}))?$/;

/**
 * Converts what the user typed in millimetres ("0,2", "0,16") to integer micrometres, or null when
 * the text is not valid or outside 10..2000. Only string and integer arithmetic: never
 * `parseFloat * 1000`, which drifts for some inputs. At most 3 decimals, so the result is exact.
 */
export function parseMmToUm(text: string): number | null {
  const match = MM_INPUT.exec(text.trim());
  if (match === null) return null;
  const um = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return um >= MIN_LAYER_UM && um <= MAX_LAYER_UM ? um : null;
}

/** The inverse: 200 becomes "0,2", 160 "0,16", 2000 "2". */
export function umToMmInput(um: number): string {
  const whole = Math.trunc(um / 1000);
  const fraction = String(um % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)},${fraction}`;
}

// ---- Other display helpers -------------------------------------------------------------------

const DATE = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** An instant ("2026-10-15T15:00:00.000Z") as dd/mm/aaaa in the browser's own time zone. */
export function formatInstantDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}

const MAX_FILE_NAME_CODE_POINTS = 255;

/**
 * The name sent as `source.fileName` (1..255 code points): control characters are removed and a
 * longer name is cut by code point, never in the middle of a surrogate pair.
 */
export function toSourceFileName(name: string): string {
  const cleaned = Array.from(name.replace(/\p{Cc}/gu, '')).slice(0, MAX_FILE_NAME_CODE_POINTS);
  // The server trims the name and rejects an empty one, which would make the whole save fail.
  const text = cleaned.join('').trim();
  return text.length === 0 ? 'archivo.gcode' : text;
}
