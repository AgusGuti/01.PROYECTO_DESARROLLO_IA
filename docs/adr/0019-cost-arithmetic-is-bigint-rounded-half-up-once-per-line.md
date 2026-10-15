# 0019. Cost arithmetic uses BigInt, rounds half up once per line, and the total is the sum of the lines

- **Status:** accepted
- **Date:** 2026-10-16

## Context

CU03 turns a part, a spool, a printer and a set of tariffs into money. ADR 0011 stored money as
integer centavos and left the cost per gram rounding open. The caps allow large products: weight
up to 20,000 g times a quantity up to 1,000 is 2×10⁷ g, and a spool price up to 10⁹ centavos
makes 2×10¹⁶, above the largest integer a JavaScript `Number` holds exactly (2⁵³ ≈ 9×10¹⁵).
Electricity and wear reach even higher intermediate values.

## Decision

- `calculateEstimate` is a pure domain function with no I/O. Inside it every operation uses
  `BigInt`; inputs and outputs are plain safe integers.
- Each line is one exact fraction, rounded **once**, half up, never through a per-gram price:
  - filament: `grams × purchaseCostMinor / initialGrams`, where `grams` is the part weight times
    the quantity;
  - electricity: `watts × seconds × kwhPriceMinor / 3,600,000` (seconds is the part time times the
    quantity);
  - wear: `seconds × wearPerHourMinor / 3,600`;
  - fixed: `fixedPerJobMinor`, once per estimate (not per unit).
- `roundHalfUpDiv(n, d) = (2n + d) / (2d)` with BigInt floor division; all operands are
  non-negative, so a tie goes up.
- `subtotalMinor` is the sum of the rounded lines, the **clean cost**. The margin is
  `round(subtotal × basisPoints / 10,000)` and is added on top: `totalMinor = subtotal + margin`.
  With no margin requested, margin is 0 and the total equals the subtotal. The displayed lines
  therefore add up to the total exactly, by construction. The distance to the exact rational
  total is at most half a centavo per line.
- `unitTotalMinor = roundHalfUpDiv(total, quantity)` is informative: `unit × quantity` can differ
  from the total by up to `quantity / 2` centavos, and the UI says it is an average.
- **Overflow guard:** every output is checked against `Number.MAX_SAFE_INTEGER`. If one exceeds
  it, the function returns `{ ok: false, reason: 'amount_too_large' }`, which the API maps to a
  400 on `quantity`. The result is never silently imprecise.
- Percentages are stored and exchanged as integer **basis points** (1/100 of a percent): 12.5 % is 1250. The web accepts a percent with up to two decimals and converts it with string arithmetic.

## Alternatives considered

- **`Number` with a per-gram price:** loses up to half a centavo per gram and the lines would not
  add up.
- **Rounding only the total:** the displayed lines would not add up to it.
- **Banker's rounding:** surprising in a shop context.
- **A decimal library:** a new dependency without a need.
- **Lower caps so `Number` suffices:** restricts real data to avoid a few `bigint` conversions.

## Consequences

- The domain has a handful of `bigint` conversions and the guard must stay tested.
- Property-style tests use a seeded generator and an independent BigInt oracle (no new
  dependency); reconsider a property-testing library at CU08.
- CU04 calls the same function per project line and sums; the fixed cost is the only input it will
  have to treat specially (ADR 0020).
