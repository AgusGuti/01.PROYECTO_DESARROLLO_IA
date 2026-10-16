# 0028. The optimiser is a greedy multi-strategy heuristic measured against the naive plan

- **Status:** accepted
- **Date:** 2026-10-16

## Context

CU08 (M3.4) asks for an explainable heuristic, pure domain code, and a measured comparison with
the CU10 naive result (ADR 0026). The queue's `goal` (CU07) says what to optimise.

## Decision

- **Endpoint:** `POST /api/v1/simulations/optimizations`, stateless (200, writes nothing), the
  same strict body as CU10 (`{ projectId, startAt }`), the same preconditions and 400 paths
  (`projectId`, `lines` over 1000 units, `printerIds`, `startAt`), plus part sizes, printer build
  volumes and the planning settings (ADR 0027) as read ports. It lives in the `simulations`
  module; the pure code is `simulations.optimizer.ts`.
- **One scheduler, several strategies.** Every candidate is built by the same loop: take the
  printer that is free earliest (tie: first in `printerIds`), start at its first intervention
  minute (14-day horizon), choose the next plate according to the strategy, collect it at the
  first intervention minute at or after its end, repeat. A unit that cannot start or be collected
  is reported as unplaced. Strategies:
  - `naive`: exactly `simulateNaive` (CU10): one print per unit, queue order, no batching.
  - `queue_order`: queue-line order, with batching.
  - `longest_first` / `shortest_first`: among the next plate of each line, the longest or the
    shortest one for the printer that receives it.
  - `best_fit`: among the next plate of each line, the one whose end leaves the least waiting time
    before its collection (`handoff - end`); a longer plate wins a tie.
- **Selection by the goal's key** (lexicographic, lower is better), evaluated for each candidate:
  - `fastest`: unplaced units, finish time, total idle minutes.
  - `minimal_idle`: unplaced units, total idle minutes, finish time.
  - `deadline`: deadline missed (0 or 1), unplaced units, finish time, total idle minutes.
    Unplaced units come first in the other goals because finishing early by dropping work is not
    an improvement. A tie keeps the earlier strategy in the order above, so `naive` wins ties.
  - Since `naive` is a candidate, **the result is never worse than the baseline for the goal**, by
    construction. A property test checks it over 300 seeded random cases.
- **Response:** `goal`, the chosen `strategy`, `baseline` (naive totals, deadline, unplaced),
  `optimized` (plates with units, `plateIndex`/`platesInLine`, printers, totals, deadline,
  unplaced), `comparison` (`finishDeltaMinutes`, `idleDeltaMinutes`, both negative when better,
  and `deadlineChanged`: `gained`, `lost`, `same` or `unknown`), `candidates` (every strategy's
  finish, idle, deadline outcome and placed or unplaced units) and `warnings` (the CU10 codes plus
  `batching_applied` when a plate holds more than one piece).

## Why it is explainable

Each strategy is a one-line rule ("longest plate first", "the plate that leaves the least wait");
the response lists what each rule produced, so a user can see why one was chosen and by how much it
beats the baseline.

## Limits

- **Greedy and not optimal.** Each choice looks only at the next start; no search, no backtracking.
  A better order may exist. The answer is only guaranteed to be no worse than the naive one and
  than the four other rules.
- **One human is not modelled** (ADR 0026): with several printers two collections may fall on the
  same minute.
- **A plate is chosen per line, not per piece:** a line's plates are formed on the fly from the
  capacity of the printer that receives them; no look-ahead about which printer takes the
  remainder.
- **Intervention only at start and end;** a print is not interrupted by a closed window.
- **Priorities between projects, filament changes and printer compatibility** (material,
  nozzle) are not considered.
- Cost: at most 1000 units, 100 lines and 10 printers; each iteration looks at one option per
  line, so five strategies finish in milliseconds.

## Alternatives considered

- **An exact solver or a metaheuristic (annealing, genetic):** hard to explain and to test; not
  justified before the heuristic's measured gap is known.
- **A single clever rule:** it cannot beat the naive result on every input; trying several and
  keeping the best can.
- **Storing the optimisation:** derived data (ADR 0026); recompute on demand.

## Consequences

- The web can show baseline and optimised side by side and explain the choice from `candidates`.
- Adding a strategy is one entry in the list and one scoring function; the property tests cover it
  without change.
- If the heuristic proves too weak, the next step is a bounded local search starting from the best
  candidate, in a new ADR.
