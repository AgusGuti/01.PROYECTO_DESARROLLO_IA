# 0020. Cost estimates are stateless; a margin applies only when the estimate is a sale

- **Status:** accepted
- **Date:** 2026-10-16

## Context

Agustín decided: the cost is computed on demand and not stored; the spool is chosen when
calculating; the margin is the profit percentage added to a piece **only when it is for sale**. The
screen shows the clean-cost subtotal first and then the total with the margin added. Standard
§8.5 asks for a threat analysis when money is involved.

## Decision

- `POST /api/v1/costs/estimates` answers 200 and writes nothing. Body (strict):
  `{ partId, filamentId, printerId?, quantity (1..1000, default 1), marginBasisPoints? }`.
- **Margin:** `marginBasisPoints` (0..100,000) present means "sale": the margin is added on the
  subtotal. Absent means not a sale: margin 0 and `total = subtotal`. The default margin in the
  settings is **only the value the form pre-fills** when the user ticks "¿Venta?"; the API never
  applies it by itself.
- Response `CostEstimate`: `quantity`, `printSeconds`, `filament { grams, costMinor }`,
  `electricity { watts, costMinor } | null`, `wear { costMinor }`, `fixed { costMinor }`,
  `subtotalMinor`, `marginBasisPoints`, `marginMinor`, `totalMinor`, `unitTotalMinor`, `warnings`.
  Every amount is integer centavos of ARS; the lines add up to the total (ADR 0019).
- **References are body input** (ADR 0016): a part, spool or printer that is unknown or deleted is
  a 400 with issues on `partId`, `filamentId` and `printerId`, all reported at once. A spool whose
  material differs from the part's is a 400 on `filamentId`. There is no 404.
- **Warnings** (a closed enum the web maps to Spanish): `filament_insufficient` (the spool has
  fewer grams than needed; the estimate stays valid), `electricity_printer_not_selected`,
  `electricity_printer_power_unknown`, `settings_not_configured` (settings never saved, so zeros
  are in use).
- A printer is optional. Without one, or without a `powerWatts`, electricity is `null` with a
  warning; the request does not fail. No printer compatibility or status check: this is a cost
  estimate, not a feasibility check.
- **Ports (ADR 0017):** `costs` owns `PartReader`, `FilamentReader` and `PrinterReader` (one id
  each, returning only the fields it needs), implemented by small factories exported from each
  provider module's `index.ts` and composed in `app.ts`. A port failure is 503 and nothing is
  written.
- The four reads (part, spool, printer, settings) are independent, not a transaction: a record
  edited between reads only affects an advisory number that is stored nowhere.
- A frozen quote, if CU04 wants one, must copy the settings and prices it was computed from.

### Threat analysis

| Scenario                                     | Control                                                    | Test                                             |
| -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Overflow or float error corrupts a price     | BigInt, safe-integer guard (ADR 0019), integer-only inputs | Property tests and the `amount_too_large` vector |
| A client sends a margin or amount as a float | Strict Zod: integers only, ranges                          | Schema tables                                    |
| Mass assignment on settings                  | Strict schema; the filter is the constant `_id`            | Unknown keys give 400                            |
| An id points to someone else's record        | No users yet (EXC-0001); references validated as live      | 400 with issue paths                             |
| Heavy computation                            | Bounded BigInt operations, no loops driven by input        | Boundary vectors finish instantly                |
| Anyone local changes the tariffs             | Loopback only while EXC-0001 holds                         | Accepted until authentication exists             |

## Alternatives considered

- **Storing estimates:** contradicts the decision and creates stale data.
- **A 404 for body ids:** the resource is the estimate, not the part.
- **A material mismatch as a warning:** a PLA part costed with a PETG spool is almost always a
  mistake; it can be loosened later without breaking the contract.
- **Applying the default margin automatically:** a cost would silently become a price.
- **A batch lookup port now:** no CU03 caller needs it; CU04 adds it.

## Consequences

- `unitTotalMinor × quantity` may differ from the total by a few centavos; the UI labels it an
  average.
- The fixed cost is charged once per estimate. CU04 must aggregate before adding it, or exclude it
  from the per-line calls, to avoid repeating it per project line.
- The structural match between each provider and its port is only checked where `app.ts` wires
  them, so an integration test through the real wiring is required.
