// Business rules for costs (CU03). Pure functions: no Express, Mongoose or Zod here.
// All money is integer centavos of ARS. Arithmetic runs in BigInt and rounds half up once per
// line (ADR 0019), so the displayed lines add up to the total exactly.
import type { Material } from '../../shared/catalog/materials.js';

/** The four editable tariffs. */
export interface CostRates {
  readonly kwhPriceMinor: number;
  readonly wearPerHourMinor: number;
  readonly fixedPerJobMinor: number;
  readonly defaultMarginBasisPoints: number;
}

/** The settings as stored. Version 0 means "never saved" (ADR 0021). */
export interface CostSettings extends CostRates {
  readonly version: number;
  readonly updatedAt: Date | null;
}

export const DEFAULT_COST_SETTINGS: CostSettings = {
  kwhPriceMinor: 0,
  wearPerHourMinor: 0,
  fixedPerJobMinor: 0,
  defaultMarginBasisPoints: 0,
  version: 0,
  updatedAt: null,
};

/** What the estimate needs to know about a part, a spool and a printer (the ports' answers). */
export interface PartCostData {
  readonly id: string;
  readonly material: Material;
  readonly estimatedWeightGrams: number;
  readonly estimatedPrintSeconds: number;
}

export interface FilamentCostData {
  readonly id: string;
  readonly material: Material;
  readonly initialGrams: number;
  readonly availableGrams: number;
  readonly purchaseCostMinor: number;
}

export interface PrinterCostData {
  readonly id: string;
  readonly powerWatts: number | null;
}

export const COST_WARNING_CODES = [
  'filament_insufficient',
  'electricity_printer_not_selected',
  'electricity_printer_power_unknown',
  'settings_not_configured',
] as const;
export type CostWarningCode = (typeof COST_WARNING_CODES)[number];

export interface EstimateInput {
  readonly part: PartCostData;
  readonly filament: FilamentCostData;
  /** Null when the request named no printer. */
  readonly printer: PrinterCostData | null;
  readonly quantity: number;
  /** 0 when the estimate is not a sale. */
  readonly marginBasisPoints: number;
  readonly settings: CostSettings;
}

export interface Estimate {
  readonly quantity: number;
  readonly printSeconds: number;
  readonly filament: { readonly grams: number; readonly costMinor: number };
  readonly electricity: { readonly watts: number; readonly costMinor: number } | null;
  readonly wear: { readonly costMinor: number };
  readonly fixed: { readonly costMinor: number };
  readonly subtotalMinor: number;
  readonly marginBasisPoints: number;
  readonly marginMinor: number;
  readonly totalMinor: number;
  readonly unitTotalMinor: number;
  readonly warnings: readonly CostWarningCode[];
}

export type EstimateResult =
  | { readonly ok: true; readonly estimate: Estimate }
  | { readonly ok: false; readonly reason: 'amount_too_large' };

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const SECONDS_PER_HOUR = 3600n;
const WATT_SECONDS_PER_KWH = 3_600_000n;
const BASIS_POINTS = 10_000n;

/** n / d rounded to the nearest integer, a tie going up. Both operands are non-negative. */
export function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n || n < 0n) throw new RangeError('roundHalfUpDiv needs n >= 0 and d > 0.');
  return (2n * n + d) / (2n * d);
}

/** Rule: each line is one exact fraction rounded once; the subtotal is the sum of the lines. */
export function calculateEstimate(input: EstimateInput): EstimateResult {
  const { part, filament, printer, settings } = input;
  const quantity = BigInt(input.quantity);
  const grams = BigInt(part.estimatedWeightGrams) * quantity;
  const seconds = BigInt(part.estimatedPrintSeconds) * quantity;

  const filamentCost = roundHalfUpDiv(
    grams * BigInt(filament.purchaseCostMinor),
    BigInt(filament.initialGrams),
  );
  const watts = printer?.powerWatts ?? null;
  const electricityCost =
    watts === null
      ? null
      : roundHalfUpDiv(
          BigInt(watts) * seconds * BigInt(settings.kwhPriceMinor),
          WATT_SECONDS_PER_KWH,
        );
  const wearCost = roundHalfUpDiv(seconds * BigInt(settings.wearPerHourMinor), SECONDS_PER_HOUR);
  const fixedCost = BigInt(settings.fixedPerJobMinor);

  const subtotal = filamentCost + (electricityCost ?? 0n) + wearCost + fixedCost;
  const margin = roundHalfUpDiv(subtotal * BigInt(input.marginBasisPoints), BASIS_POINTS);
  const total = subtotal + margin;
  const unit = roundHalfUpDiv(total, quantity);

  // Never return an imprecise number: every output must be a safe integer.
  const outputs = [grams, seconds, filamentCost, electricityCost ?? 0n, wearCost, fixedCost];
  if ([...outputs, subtotal, margin, total, unit].some((value) => value > MAX_SAFE)) {
    return { ok: false, reason: 'amount_too_large' };
  }

  const warnings: CostWarningCode[] = [];
  if (BigInt(filament.availableGrams) < grams) warnings.push('filament_insufficient');
  if (printer === null) warnings.push('electricity_printer_not_selected');
  else if (watts === null) warnings.push('electricity_printer_power_unknown');
  if (settings.version === 0) warnings.push('settings_not_configured');

  return {
    ok: true,
    estimate: {
      quantity: input.quantity,
      printSeconds: Number(seconds),
      filament: { grams: Number(grams), costMinor: Number(filamentCost) },
      electricity:
        watts === null || electricityCost === null
          ? null
          : { watts, costMinor: Number(electricityCost) },
      wear: { costMinor: Number(wearCost) },
      fixed: { costMinor: Number(fixedCost) },
      subtotalMinor: Number(subtotal),
      marginBasisPoints: input.marginBasisPoints,
      marginMinor: Number(margin),
      totalMinor: Number(total),
      unitTotalMinor: Number(unit),
      warnings,
    },
  };
}

export interface ProjectLineInput {
  readonly part: PartCostData;
  readonly filament: FilamentCostData;
  readonly printer: PrinterCostData | null;
  readonly quantity: number;
  readonly marginBasisPoints: number;
}

/** A line's estimate (its `fixed` is always 0: the project pays the fixed cost once). */
export interface ProjectLineEstimate extends Estimate {
  readonly partId: string;
}

export interface ProjectEstimate {
  readonly lines: readonly ProjectLineEstimate[];
  readonly fixed: { readonly costMinor: number };
  readonly subtotalMinor: number;
  readonly marginMinor: number;
  readonly totalMinor: number;
  readonly printSeconds: number;
  readonly materials: readonly { readonly material: Material; readonly grams: number }[];
  readonly warnings: readonly CostWarningCode[];
}

/** `lineIndex` is the offending line, or null when only the sum over all lines overflows. */
export type ProjectEstimateResult =
  | { readonly ok: true; readonly estimate: ProjectEstimate }
  | { readonly ok: false; readonly reason: 'amount_too_large'; readonly lineIndex: number | null };

/**
 * Rule (CU04, ADR 0023): cost each line alone with the fixed cost removed, add the settings'
 * fixed cost ONCE after summing (no margin on it), and total by summing already rounded lines.
 */
export function calculateProjectEstimate(
  lines: readonly ProjectLineInput[],
  settings: CostSettings,
): ProjectEstimateResult {
  const perLine = { ...settings, fixedPerJobMinor: 0 };
  const estimates: ProjectLineEstimate[] = [];
  for (const [index, line] of lines.entries()) {
    const result = calculateEstimate({ ...line, settings: perLine });
    if (!result.ok) return { ok: false, reason: 'amount_too_large', lineIndex: index };
    estimates.push({ partId: line.part.id, ...result.estimate });
  }

  const fixed = BigInt(settings.fixedPerJobMinor);
  let subtotal = fixed;
  let margin = 0n;
  let seconds = 0n;
  const grams = new Map<Material, bigint>();
  const perSpool = new Map<string, bigint>();
  for (const [index, estimate] of estimates.entries()) {
    subtotal += BigInt(estimate.subtotalMinor);
    margin += BigInt(estimate.marginMinor);
    seconds += BigInt(estimate.printSeconds);
    const spool = lines[index]?.filament;
    if (spool !== undefined) {
      perSpool.set(spool.id, (perSpool.get(spool.id) ?? 0n) + BigInt(estimate.filament.grams));
    }
    const material = lines[index]?.part.material;
    if (material !== undefined) {
      grams.set(material, (grams.get(material) ?? 0n) + BigInt(estimate.filament.grams));
    }
  }
  const total = subtotal + margin;
  const sums = [subtotal, margin, total, seconds, ...grams.values()];
  if (sums.some((value) => value > MAX_SAFE)) {
    return { ok: false, reason: 'amount_too_large', lineIndex: null };
  }

  const present = new Set(estimates.flatMap((estimate) => estimate.warnings));
  // Lines may share a spool: each fits alone, yet together they can exceed what is left.
  for (const line of lines) {
    if ((perSpool.get(line.filament.id) ?? 0n) > BigInt(line.filament.availableGrams)) {
      present.add('filament_insufficient');
    }
  }
  return {
    ok: true,
    estimate: {
      lines: estimates,
      fixed: { costMinor: Number(fixed) },
      subtotalMinor: Number(subtotal),
      marginMinor: Number(margin),
      totalMinor: Number(total),
      printSeconds: Number(seconds),
      materials: [...grams.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([material, amount]) => ({ material, grams: Number(amount) })),
      warnings: COST_WARNING_CODES.filter((code) => present.has(code)),
    },
  };
}
