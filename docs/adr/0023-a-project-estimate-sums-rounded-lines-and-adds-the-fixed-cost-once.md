# 0023. A project estimate sums rounded lines and adds the fixed cost once

- **Status:** accepted
- **Date:** 2026-10-17

## Context

CU04 asks for the total cost of a project. A project has lines (a part and a quantity, ADR 0016)
and the cost module already computes one line (ADR 0019, 0020). Agustín decided: the spool,
printer and margin are chosen per line; nothing is stored. Standard §8.5 asks for a threat
analysis when money is involved.

## Decision

- `POST /api/v1/costs/project-estimates` answers 200 and writes nothing. Body (strict):
  `{ lines: [{ partId, filamentId, printerId?, quantity (1..1000), marginBasisPoints? (0..100000) }] }`
  with 1 to 100 lines. 100 mirrors `MAX_ITEMS` of the projects module, copied as a local constant
  because modules do not import each other (ADR 0017). The web builds the lines from the project
  it loads through the projects API.
- **No new module, port or dependency.** It reuses `calculateEstimate`, the three read ports and
  the settings repository. The aggregation is the pure function `calculateProjectEstimate` in
  `costs.domain.ts`.
- **Each line** is costed with `calculateEstimate` and `fixedPerJobMinor: 0`. The settings fixed
  cost is added **once** after summing and carries **no margin**; the margin is per line, on that
  line's subtotal.
- **Response:** `lines[]` (`partId` plus the CU03 estimate fields without `fixed`), `fixed
{ costMinor }`, `subtotalMinor` (line subtotals + fixed), `marginMinor` (sum of line margins),
  `totalMinor`, `printSeconds` (sum), `materials[] { material, grams }` (summed per material,
  sorted by name) and `warnings[]` (union of the line warnings, deduplicated, same closed enum).
- **Exact sums:** totals are sums of already rounded lines (ADR 0019), so the screen adds up to
  the centavo. Sums run in BigInt. If any line or any sum exceeds `MAX_SAFE_INTEGER` the answer is
  400 `amount_too_large`: path `lines.N.quantity` when line N overflows by itself, path `lines`
  when only the sum does.
- **Validation:** all unknown or deleted references are reported at once with indexed paths
  `lines.N.partId|filamentId|printerId`; a spool of another material than the part is reported on
  `lines.N.filamentId`. Distinct ids are read once each, in parallel; a port failure is 503.
  Same precedence and handling as the CU03 estimate. The same part may appear on several lines.
- **Shared spool:** `filament_insufficient` is also raised for the project when the grams needed
  by all lines that use the same spool exceed its `availableGrams`, even if each line fits alone.
  The enum is unchanged.
- Reads are independent, not a transaction: the number is advisory and stored nowhere.

### Threat analysis

| Scenario                                         | Control                                                              | Test                                       |
| ------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------ |
| Request amplification (many lines, repeated ids) | At most 100 lines, quantity at most 1000; each distinct id read once | Route 101 lines is 400; service reads once |
| Overflow of a line or of the sum                 | BigInt, safe-integer guard on lines and on every sum                 | Domain and service overflow vectors        |
| Mass assignment or unexpected fields             | Strict body and strict line; DTO built field by field                | Unknown keys give 400; exact key list      |
| References to deleted or foreign records         | Each id resolved through a port; no users yet (EXC-0001)             | Indexed issue paths; real-wiring test      |
| Dependency failure shown as "does not exist"     | Port failure is 503 with a generic message                           | 503 tests per dependency                   |
| A fixed cost repeated per line                   | Lines computed with fixed 0; fixed added once                        | Domain worked example                      |

## Alternatives considered

- **Storing the estimate on the project:** stale data; contradicts ADR 0020.
- **Reading the project inside costs:** would make costs depend on projects (ADR 0017); the web
  already has the project.
- **Margin on the fixed cost:** the margin is a per-line sale decision; the fixed cost belongs
  to the job, not to a line.
- **One spool and printer for the whole project:** different parts have different materials.

## Consequences

- The web sends the lines it holds; a project edited in the meantime is the web's concern.
- `unitTotalMinor` stays per line; the project has no unit price.
- The 100 line limit must be updated here if the projects module changes `MAX_ITEMS`.
