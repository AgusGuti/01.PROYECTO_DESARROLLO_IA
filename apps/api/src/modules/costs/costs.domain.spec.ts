import { describe, expect, it } from 'vitest';
import {
  calculateEstimate,
  calculateProjectEstimate,
  DEFAULT_COST_SETTINGS,
  roundHalfUpDiv,
  type CostSettings,
  type Estimate,
  type EstimateInput,
} from './costs.domain.js';
import { filamentData, partData, printerData, validRates } from './testing/fakes.js';

const settings = { ...validRates, version: 1, updatedAt: new Date('2026-03-01T10:00:00.000Z') };

function build(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    part: { ...partData },
    filament: { ...filamentData },
    printer: { ...printerData },
    quantity: 1,
    marginBasisPoints: 0,
    settings,
    ...overrides,
  };
}

function estimateOf(input: EstimateInput): Estimate {
  const result = calculateEstimate(input);
  if (!result.ok) throw new Error('expected an estimate');
  return result.estimate;
}

// Hand-computed so they do not depend on the production formulas. Everything else is set to zero
// so that exactly one line produces the number being checked.
function onlyWear(seconds: number, wearPerHourMinor: number, marginBasisPoints = 0): Estimate {
  return estimateOf(
    build({
      part: { ...partData, estimatedWeightGrams: 1, estimatedPrintSeconds: seconds },
      filament: { ...filamentData, purchaseCostMinor: 0 },
      printer: null,
      marginBasisPoints,
      settings: { ...settings, kwhPriceMinor: 0, wearPerHourMinor, fixedPerJobMinor: 0 },
    }),
  );
}

describe('hand-computed rounding vectors', () => {
  it.each([
    [1, 1800, 1], // 1 s at 1800 c/h is exactly 0.5 c: the tie goes up
    [1, 1799, 0], // just under the tie goes down
    [1, 1801, 1],
    [3600, 50, 50], // one hour
    [5400, 100, 150], // one and a half hours
    [7, 3600, 7],
  ])('charges %i s of wear at %i c/h as %i c', (seconds, rate, expected) => {
    expect(onlyWear(seconds, rate).wear.costMinor).toBe(expected);
  });

  it.each([
    [5000, 2], // the subtotal is 1 c; half of it is 0.5 c, which goes up: total 2
    [4999, 1], // 0.4999 c goes down: total 1
    [10_000, 2], // +100 %
    [0, 1],
  ])('adds a margin of %i basis points to a subtotal of 1 c for a total of %i c', (bp, total) => {
    const estimate = onlyWear(1, 1800, bp);

    expect(estimate.subtotalMinor).toBe(1);
    expect(estimate.totalMinor).toBe(total);
    expect(estimate.marginMinor + estimate.subtotalMinor).toBe(estimate.totalMinor);
  });

  it('rounds the unit price half up: a total of 5 c over 2 copies is 3 c', () => {
    const estimate = estimateOf(
      build({
        part: { ...partData, estimatedWeightGrams: 1, estimatedPrintSeconds: 1 },
        filament: { ...filamentData, purchaseCostMinor: 0 },
        printer: null,
        quantity: 2,
        settings: { ...settings, kwhPriceMinor: 0, wearPerHourMinor: 0, fixedPerJobMinor: 5 },
      }),
    );

    expect(estimate.totalMinor).toBe(5);
    expect(estimate.unitTotalMinor).toBe(3);
  });

  it('charges the fixed cost once however many copies are made', () => {
    const one = estimateOf(build({ quantity: 1 })).fixed.costMinor;
    const ten = estimateOf(build({ quantity: 10 })).fixed.costMinor;

    expect(one).toBe(5000);
    expect(ten).toBe(5000);
  });
});

describe('roundHalfUpDiv', () => {
  it.each([
    [1n, 2n, 1n],
    [1n, 3n, 0n],
    [2n, 3n, 1n],
    [3n, 2n, 2n],
    [5n, 2n, 3n],
    [0n, 7n, 0n],
    [10n, 5n, 2n],
  ])('rounds %s / %s to %s with ties going up', (n, d, expected) => {
    expect(roundHalfUpDiv(n, d)).toBe(expected);
  });

  it('rejects a zero divisor and a negative numerator', () => {
    expect(() => roundHalfUpDiv(1n, 0n)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(-1n, 2n)).toThrow(RangeError);
  });
});

describe('calculateEstimate: the worked example (ADR 0019)', () => {
  const input = build({ quantity: 2, marginBasisPoints: 2500 });

  it('reproduces every amount exactly for a sale', () => {
    expect(calculateEstimate(input)).toEqual({
      ok: true,
      estimate: {
        quantity: 2,
        printSeconds: 14_400,
        filament: { grams: 200, costMinor: 400_000 },
        electricity: { watts: 270, costMinor: 8640 },
        wear: { costMinor: 600 },
        fixed: { costMinor: 5000 },
        subtotalMinor: 414_240,
        marginBasisPoints: 2500,
        marginMinor: 103_560,
        totalMinor: 517_800,
        unitTotalMinor: 258_900,
        warnings: [],
      },
    });
  });

  it('adds no margin when the estimate is not a sale', () => {
    const estimate = estimateOf({ ...input, marginBasisPoints: 0 });

    expect(estimate).toMatchObject({
      marginBasisPoints: 0,
      marginMinor: 0,
      subtotalMinor: 414_240,
      totalMinor: 414_240,
      unitTotalMinor: 207_120,
    });
  });
});

describe('calculateEstimate: line vectors', () => {
  const zeroRates = { ...settings, kwhPriceMinor: 0, wearPerHourMinor: 0, fixedPerJobMinor: 0 };
  const freeSpool = { ...filamentData, purchaseCostMinor: 0 };

  it('charges 100 centavos for 1000 W during one hour at 100 centavos per kWh', () => {
    const estimate = estimateOf(
      build({
        filament: freeSpool,
        part: { ...partData, estimatedPrintSeconds: 3600 },
        printer: { id: printerData.id, powerWatts: 1000 },
        settings: { ...zeroRates, kwhPriceMinor: 100 },
      }),
    );

    expect(estimate.electricity).toEqual({ watts: 1000, costMinor: 100 });
  });

  it('rounds 270 W during one hour at 8537 centavos per kWh up to 2305', () => {
    const estimate = estimateOf(
      build({
        filament: freeSpool,
        part: { ...partData, estimatedPrintSeconds: 3600 },
        settings: { ...zeroRates, kwhPriceMinor: 8537 },
      }),
    );

    expect(estimate.electricity?.costMinor).toBe(2305);
  });

  it('charges the wear per hour proportionally to the seconds', () => {
    const estimate = estimateOf(
      build({
        filament: freeSpool,
        part: { ...partData, estimatedPrintSeconds: 3600 },
        settings: { ...zeroRates, wearPerHourMinor: 50 },
      }),
    );

    expect(estimate.wear.costMinor).toBe(50);
  });

  it('sends a tie up: 1 g of a spool of 2 g costing 1 centavo is 1 centavo', () => {
    const estimate = estimateOf(
      build({
        filament: { ...filamentData, initialGrams: 2, purchaseCostMinor: 1 },
        part: { ...partData, estimatedWeightGrams: 1 },
        printer: null,
        settings: zeroRates,
      }),
    );

    expect(estimate.filament.costMinor).toBe(1);
  });

  it('charges the fixed cost once whatever the quantity', () => {
    const estimate = estimateOf(build({ quantity: 1000 }));

    expect(estimate.fixed.costMinor).toBe(5000);
  });

  it('turns the margin of 10000 basis points into a doubled total', () => {
    const estimate = estimateOf(build({ marginBasisPoints: 10_000 }));

    expect(estimate.marginMinor).toBe(estimate.subtotalMinor);
    expect(estimate.totalMinor).toBe(estimate.subtotalMinor * 2);
  });

  it('makes the unit total equal the total for a quantity of 1', () => {
    const estimate = estimateOf(build({ marginBasisPoints: 1234 }));

    expect(estimate.unitTotalMinor).toBe(estimate.totalMinor);
  });
});

describe('calculateEstimate: overflow guard', () => {
  const huge = {
    filament: { ...filamentData, initialGrams: 1, availableGrams: 1, purchaseCostMinor: 1e9 },
    part: { ...partData, estimatedWeightGrams: 20_000 },
    printer: null,
  };

  it('refuses an amount above the largest safe integer', () => {
    expect(calculateEstimate(build({ ...huge, quantity: 1000 }))).toEqual({
      ok: false,
      reason: 'amount_too_large',
    });
  });

  it('accepts 2e13 centavos with a quantity of 1', () => {
    const estimate = estimateOf(build({ ...huge, quantity: 1 }));

    expect(estimate.filament.costMinor).toBe(2e13);
  });

  it('refuses when only the margin pushes the total over the limit', () => {
    // Subtotal just under the limit; a 100 % margin doubles it.
    const result = calculateEstimate(
      build({
        ...huge,
        part: { ...partData, estimatedWeightGrams: 9007 },
        quantity: 1000,
        marginBasisPoints: 100_000,
        settings: { ...settings, kwhPriceMinor: 0, wearPerHourMinor: 0, fixedPerJobMinor: 0 },
      }),
    );

    expect(result).toEqual({ ok: false, reason: 'amount_too_large' });
  });
});

describe('calculateEstimate: warnings', () => {
  it('warns when the spool has fewer grams than needed, but not when it has exactly enough', () => {
    const short = estimateOf(build({ filament: { ...filamentData, availableGrams: 99 } }));
    const exact = estimateOf(build({ filament: { ...filamentData, availableGrams: 100 } }));

    expect(short.warnings).toEqual(['filament_insufficient']);
    expect(exact.warnings).toEqual([]);
  });

  it('warns when the quantity makes the need exceed the spool', () => {
    const estimate = estimateOf(build({ quantity: 11 }));

    expect(estimate.warnings).toEqual(['filament_insufficient']);
  });

  it('warns that no printer was selected and omits electricity', () => {
    const estimate = estimateOf(build({ printer: null }));

    expect(estimate.electricity).toBeNull();
    expect(estimate.warnings).toEqual(['electricity_printer_not_selected']);
  });

  it('warns that the printer power is unknown and omits electricity', () => {
    const estimate = estimateOf(build({ printer: { id: printerData.id, powerWatts: null } }));

    expect(estimate.electricity).toBeNull();
    expect(estimate.warnings).toEqual(['electricity_printer_power_unknown']);
  });

  it('warns that the settings were never saved', () => {
    const estimate = estimateOf(build({ settings: DEFAULT_COST_SETTINGS }));

    expect(estimate.warnings).toEqual(['settings_not_configured']);
  });

  it('lists several warnings in a fixed order', () => {
    const estimate = estimateOf(
      build({
        filament: { ...filamentData, availableGrams: 0 },
        printer: null,
        settings: DEFAULT_COST_SETTINGS,
      }),
    );

    expect(estimate.warnings).toEqual([
      'filament_insufficient',
      'electricity_printer_not_selected',
      'settings_not_configured',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property tests. No dependency: a seeded generator (the run is the same every time) and an
// independent oracle that rounds with quotient and remainder instead of the (2n + d) / 2d formula.
// ---------------------------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32): a number in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Raw {
  weight: number;
  seconds: number;
  quantity: number;
  initialGrams: number;
  cost: number;
  watts: number | null;
  kwh: number;
  wear: number;
  fixed: number;
  bp: number;
}

const CASES = 2000;

function rawCase(random: () => number): Raw {
  // Edges are over-represented: the minimum, the maximum and tiny values break rounding first.
  const pick = (min: number, max: number): number => {
    const roll = random();
    if (roll < 0.15) return max;
    if (roll < 0.3) return min;
    if (roll < 0.45) return Math.min(max, min + Math.floor(random() * 4));
    return min + Math.floor(random() ** 2 * (max - min + 1));
  };
  return {
    weight: pick(1, 20_000),
    seconds: pick(1, 2_592_000),
    quantity: pick(1, 1000),
    initialGrams: pick(1, 20_000),
    cost: pick(0, 1_000_000_000),
    watts: random() < 0.2 ? null : pick(1, 5000),
    kwh: pick(0, 1_000_000_000),
    wear: pick(0, 1_000_000_000),
    fixed: pick(0, 1_000_000_000),
    bp: pick(0, 100_000),
  };
}

function inputOf(raw: Raw): EstimateInput {
  return build({
    part: { ...partData, estimatedWeightGrams: raw.weight, estimatedPrintSeconds: raw.seconds },
    filament: {
      ...filamentData,
      initialGrams: raw.initialGrams,
      availableGrams: raw.initialGrams,
      purchaseCostMinor: raw.cost,
    },
    printer: raw.watts === null ? null : { id: printerData.id, powerWatts: raw.watts },
    quantity: raw.quantity,
    marginBasisPoints: raw.bp,
    settings: {
      ...settings,
      kwhPriceMinor: raw.kwh,
      wearPerHourMinor: raw.wear,
      fixedPerJobMinor: raw.fixed,
    },
  });
}

/** Nearest integer to n / d, ties up, by quotient and remainder. */
function oracleRound(n: bigint, d: bigint): bigint {
  const quotient = n / d;
  return 2n * (n % d) >= d ? quotient + 1n : quotient;
}

/** The exact value of a line, as the pair [n, d], and the same line rounded by the oracle. */
function oracleOf(raw: Raw) {
  const q = BigInt(raw.quantity);
  const grams = BigInt(raw.weight) * q;
  const seconds = BigInt(raw.seconds) * q;
  const fil: [bigint, bigint] = [grams * BigInt(raw.cost), BigInt(raw.initialGrams)];
  const elec: [bigint, bigint] | null =
    raw.watts === null ? null : [BigInt(raw.watts) * seconds * BigInt(raw.kwh), 3_600_000n];
  const wear: [bigint, bigint] = [seconds * BigInt(raw.wear), 3600n];
  const filament = oracleRound(...fil);
  const electricity = elec === null ? null : oracleRound(...elec);
  const wearCost = oracleRound(...wear);
  const subtotal = filament + (electricity ?? 0n) + wearCost + BigInt(raw.fixed);
  const margin: [bigint, bigint] = [subtotal * BigInt(raw.bp), 10_000n];
  const marginCost = oracleRound(...margin);
  const total = subtotal + marginCost;
  const unit: [bigint, bigint] = [total, q];
  return {
    exact: { fil, elec, wear, margin, unit },
    rounded: {
      filament,
      electricity,
      wear: wearCost,
      subtotal,
      margin: marginCost,
      total,
      unit: oracleRound(...unit),
    },
    outputs: [
      grams,
      seconds,
      filament,
      electricity ?? 0n,
      wearCost,
      BigInt(raw.fixed),
      subtotal,
      marginCost,
      total,
      oracleRound(...unit),
    ],
  };
}

/** Is `rounded` the nearest integer to n / d, a tie going up? (-d < 2(rounded d - n) <= d) */
function isHalfUpOf(rounded: bigint, [n, d]: [bigint, bigint]): boolean {
  const gap = 2n * (rounded * d - n);
  return gap > -d && gap <= d;
}

describe('calculateEstimate: properties over 2000 seeded cases', () => {
  const random = mulberry32(0xc057);
  const cases = Array.from({ length: CASES }, () => rawCase(random));

  it('matches an independent BigInt oracle and the safe-integer rule on every case', () => {
    let accepted = 0;
    let refused = 0;
    for (const raw of cases) {
      const oracle = oracleOf(raw);
      const result = calculateEstimate(inputOf(raw));
      const fits = oracle.outputs.every((value) => value <= BigInt(Number.MAX_SAFE_INTEGER));

      expect(result.ok).toBe(fits);
      if (!result.ok) {
        refused += 1;
        continue;
      }
      accepted += 1;
      const e = result.estimate;
      expect(BigInt(e.filament.costMinor)).toBe(oracle.rounded.filament);
      expect(e.electricity === null ? null : BigInt(e.electricity.costMinor)).toBe(
        oracle.rounded.electricity,
      );
      expect(BigInt(e.wear.costMinor)).toBe(oracle.rounded.wear);
      expect(BigInt(e.subtotalMinor)).toBe(oracle.rounded.subtotal);
      expect(BigInt(e.marginMinor)).toBe(oracle.rounded.margin);
      expect(BigInt(e.totalMinor)).toBe(oracle.rounded.total);
      expect(BigInt(e.unitTotalMinor)).toBe(oracle.rounded.unit);
      for (const value of [e.subtotalMinor, e.totalMinor, e.unitTotalMinor, e.marginMinor]) {
        expect(Number.isSafeInteger(value)).toBe(true);
      }
    }
    // The generator must exercise both branches, or the test proves nothing.
    expect(accepted).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(20);
  });

  it('keeps every line within half a centavo of the exact value, ties going up', () => {
    for (const raw of cases) {
      const result = calculateEstimate(inputOf(raw));
      if (!result.ok) continue;
      const { exact } = oracleOf(raw);
      const e = result.estimate;
      expect(isHalfUpOf(BigInt(e.filament.costMinor), exact.fil)).toBe(true);
      if (exact.elec !== null && e.electricity !== null) {
        expect(isHalfUpOf(BigInt(e.electricity.costMinor), exact.elec)).toBe(true);
      }
      expect(isHalfUpOf(BigInt(e.wear.costMinor), exact.wear)).toBe(true);
      expect(isHalfUpOf(BigInt(e.marginMinor), exact.margin)).toBe(true);
      expect(isHalfUpOf(BigInt(e.unitTotalMinor), exact.unit)).toBe(true);
    }
  });

  it('makes the lines add up to the subtotal and the subtotal plus the margin to the total', () => {
    for (const raw of cases) {
      const result = calculateEstimate(inputOf(raw));
      if (!result.ok) continue;
      const e = result.estimate;
      const lines = e.filament.costMinor + (e.electricity?.costMinor ?? 0) + e.wear.costMinor;
      expect(lines + e.fixed.costMinor).toBe(e.subtotalMinor);
      expect(e.subtotalMinor + e.marginMinor).toBe(e.totalMinor);
    }
  });

  it('gives a total of zero margin for 0 basis points and a doubled one for 10000', () => {
    for (const raw of cases.slice(0, 500)) {
      const none = calculateEstimate(inputOf({ ...raw, bp: 0 }));
      const full = calculateEstimate(inputOf({ ...raw, bp: 10_000 }));
      if (none.ok) {
        expect(none.estimate.marginMinor).toBe(0);
        expect(none.estimate.totalMinor).toBe(none.estimate.subtotalMinor);
      }
      if (full.ok) expect(full.estimate.totalMinor).toBe(full.estimate.subtotalMinor * 2);
    }
  });

  it('makes the unit total equal the total when the quantity is 1', () => {
    for (const raw of cases.slice(0, 500)) {
      const result = calculateEstimate(inputOf({ ...raw, quantity: 1 }));
      if (result.ok) expect(result.estimate.unitTotalMinor).toBe(result.estimate.totalMinor);
    }
  });

  it('never lowers the total when an input grows (or the spool weight shrinks)', () => {
    const total = (raw: Raw): number => {
      const result = calculateEstimate(inputOf(raw));
      // Too large counts as infinite: growing an input must not turn a refusal into an estimate.
      return result.ok ? result.estimate.totalMinor : Number.POSITIVE_INFINITY;
    };
    const grow: ((raw: Raw) => Raw)[] = [
      (raw) => ({ ...raw, weight: Math.min(20_000, raw.weight + 1 + (raw.weight % 7)) }),
      (raw) => ({ ...raw, seconds: Math.min(2_592_000, raw.seconds + 1 + (raw.seconds % 97)) }),
      (raw) => ({ ...raw, quantity: Math.min(1000, raw.quantity + 1) }),
      (raw) => ({ ...raw, initialGrams: Math.max(1, raw.initialGrams - 1) }),
      (raw) => ({ ...raw, cost: Math.min(1e9, raw.cost + 1 + (raw.cost % 13)) }),
      (raw) => ({ ...raw, watts: raw.watts === null ? null : Math.min(5000, raw.watts + 1) }),
      (raw) => ({ ...raw, kwh: Math.min(1e9, raw.kwh + 1 + (raw.kwh % 11)) }),
      (raw) => ({ ...raw, wear: Math.min(1e9, raw.wear + 1 + (raw.wear % 11)) }),
      (raw) => ({ ...raw, fixed: Math.min(1e9, raw.fixed + 1) }),
      (raw) => ({ ...raw, bp: Math.min(100_000, raw.bp + 1 + (raw.bp % 17)) }),
    ];
    for (const raw of cases.slice(0, 800)) {
      const base = total(raw);
      for (const change of grow) expect(total(change(raw))).toBeGreaterThanOrEqual(base);
    }
  });
});

describe('calculateProjectEstimate', () => {
  // Hand-computed. Line A is the CU03 worked example without the fixed cost:
  // filament 400000 + electricity 8640 + wear 600 = 409240; margin 25 % = 102310; total 511550.
  const lineA = {
    part: { ...partData },
    filament: { ...filamentData },
    printer: { ...printerData },
    quantity: 2,
    marginBasisPoints: 2500,
  };
  // Line B: PLA 50 g, 7200 s, spool 500 g at 1000000, no printer, no margin:
  // filament 100000 + wear 300 = 100300.
  const lineB = {
    part: { ...partData, id: 'e'.repeat(24), material: 'PLA' as const, estimatedWeightGrams: 50 },
    filament: {
      ...filamentData,
      id: 'f'.repeat(24),
      material: 'PLA' as const,
      initialGrams: 500,
      availableGrams: 500,
      purchaseCostMinor: 1_000_000,
    },
    printer: null,
    quantity: 1,
    marginBasisPoints: 0,
  };
  const projectOf = (
    lines: Parameters<typeof calculateProjectEstimate>[0],
    rates: CostSettings = settings,
  ) => {
    const result = calculateProjectEstimate(lines, rates);
    if (!result.ok) throw new Error('expected a project estimate');
    return result.estimate;
  };

  it('costs one line without fixed and adds the fixed cost once, with no margin', () => {
    const { lines, ...project } = projectOf([lineA]);

    expect(lines[0]).toMatchObject({
      subtotalMinor: 409_240,
      marginMinor: 102_310,
      totalMinor: 511_550,
      fixed: { costMinor: 0 },
    });
    expect(project).toMatchObject({
      fixed: { costMinor: 5000 },
      subtotalMinor: 414_240,
      marginMinor: 102_310,
      totalMinor: 516_550,
      printSeconds: 14_400,
      materials: [{ material: 'PETG', grams: 200 }],
      warnings: [],
    });
  });

  it('sums two lines of two materials, sorted by material, and unions the warnings', () => {
    const project = projectOf([lineB, lineA]);

    expect(project.lines.map((line) => line.partId)).toEqual([lineB.part.id, partData.id]);
    expect(project).toMatchObject({
      subtotalMinor: 514_540, // 100300 + 409240 + 5000
      marginMinor: 102_310,
      totalMinor: 616_850,
      printSeconds: 21_600,
      materials: [
        { material: 'PETG', grams: 200 },
        { material: 'PLA', grams: 50 },
      ],
      warnings: ['electricity_printer_not_selected'],
    });
  });

  it('allows the same part on two lines and sums their grams', () => {
    const line = { ...lineA, quantity: 1, marginBasisPoints: 0 }; // 200000 + 4320 + 300 = 204620
    const project = projectOf([line, line]);

    expect(project).toMatchObject({
      subtotalMinor: 414_240, // 2 x 204620 + 5000
      totalMinor: 414_240,
      materials: [{ material: 'PETG', grams: 200 }],
    });
  });

  it('warns when lines sharing a spool together need more than it has, though each fits', () => {
    // 600 g + 600 g = 1200 g against a spool with 1000 g left.
    const heavy = { ...lineA, part: { ...partData, estimatedWeightGrams: 600 }, quantity: 1 };
    const spoolOf = (availableGrams: number) => ({ ...filamentData, availableGrams });

    const short = projectOf([
      { ...heavy, filament: spoolOf(1000) },
      { ...heavy, filament: spoolOf(1000) },
    ]);
    const enough = projectOf([
      { ...heavy, filament: spoolOf(2000) },
      { ...heavy, filament: spoolOf(2000) },
    ]);

    expect(short.lines.every((line) => !line.warnings.includes('filament_insufficient'))).toBe(
      true,
    );
    expect(short.warnings).toEqual(['filament_insufficient']);
    expect(enough.warnings).toEqual([]);
  });

  it('reports one warning once even when every line has it, and settings_not_configured', () => {
    const project = projectOf([lineB, lineB], DEFAULT_COST_SETTINGS);

    expect(project.warnings).toEqual([
      'electricity_printer_not_selected',
      'settings_not_configured',
    ]);
    expect(project.fixed.costMinor).toBe(0);
  });

  it('names the line whose own amounts overflow', () => {
    const huge = {
      ...lineA,
      part: { ...partData, estimatedWeightGrams: 20_000 },
      filament: { ...filamentData, initialGrams: 1, purchaseCostMinor: 1e9 },
      quantity: 1000,
    };

    expect(calculateProjectEstimate([lineB, huge], settings)).toEqual({
      ok: false,
      reason: 'amount_too_large',
      lineIndex: 1,
    });
  });

  it('rejects a sum of safe lines that is not safe, naming no line', () => {
    // 5e6 g x 1e9 / 1 g... = 5e15 per line (safe); two lines = 1e16 > MAX_SAFE_INTEGER.
    const big = {
      ...lineB,
      part: { ...lineB.part, estimatedWeightGrams: 5000 },
      filament: { ...lineB.filament, initialGrams: 1, availableGrams: 1, purchaseCostMinor: 1e9 },
      quantity: 1000,
    };
    const zero = { ...settings, wearPerHourMinor: 0, fixedPerJobMinor: 0 };

    expect(projectOf([big], zero).subtotalMinor).toBe(5e15);
    expect(calculateProjectEstimate([big, big], zero)).toEqual({
      ok: false,
      reason: 'amount_too_large',
      lineIndex: null,
    });
  });
});
