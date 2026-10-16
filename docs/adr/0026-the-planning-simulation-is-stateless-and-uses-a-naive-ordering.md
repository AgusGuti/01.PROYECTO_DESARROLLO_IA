# 0026. The planning simulation is stateless and uses a naive ordering

- **Status:** accepted
- **Date:** 2026-10-16

## Context

CU10 (M3.3) shows what the plan of a project would look like on a timeline, first with a naive
ordering so that the optimiser (CU08, M3.4) can later be compared against something. It reads the
queue (ADR 0025), the intervention schedule (ADR 0024), parts, printers and the project deadline.
Agustín decided: naive first; intervention is needed at the start and at the end of each print;
Argentina time, horizon up to 14 days; the user picks the start (the web pre-fills "now" rounded
up to 15 minutes).

## Decision

- **Stateless, like ADR 0020.** `POST /api/v1/simulations` answers 200 and writes nothing. Body
  (strict): `{ projectId, startAt }`. `startAt` is a local wall-clock string `YYYY-MM-DDTHH:mm`:
  a real calendar day in 2000..2099, minutes 00..59, no seconds, no zone suffix. The module owns
  no collection and no repository.
- **Ports owned by the module** (ADR 0017), built in `app.ts` from factories exported by each
  provider's `index.ts`: the queue, the project (live, plus its deadline as `YYYY-MM-DD`), the
  parts in one batch, the printers (live and not archived, with name) and the schedule (stored,
  or the defaults at version 0). The domain imports only the pure `interventionRangesFor` of the
  availability module, through its `index.ts`. A port that rejects is a generic 503.
- **Preconditions.** No queue or project removed: 400 on `projectId`. More than
  1000 remaining units: 400 on `lines`, message starting `too_many_units`. A deleted part is
  skipped (warning `part_deleted`); an archived or deleted printer is skipped (warning
  `printer_unavailable`); none left: 400 on `printerIds`.
- **Time** is an integer count of minutes since 1970-01-01 of the Argentina calendar (UTC-3, no
  daylight saving, ADR 0024). `Date.UTC` is used only as a calendar calculator; no local zone.
- **Naive algorithm** (`simulateNaive`, pure): one job per remaining unit (`quantity -
completed`) of each queue line, in line order, unit by unit. Each unit goes to the printer that
  is free earliest (tie: first in `printerIds`). A print may start only at a minute where
  intervention is possible (end-exclusive); if the printer is free outside a window the start
  waits for the next window minute. Duration is `ceil(seconds / 60)` minutes (at least 1). The
  piece is removed (`handoffAt`) at the first intervention minute at or after the end, and only
  then is the printer free. Per job, busy time is `end - start` (printing) and idle time is
  `handoff - end` (the printer is finished and waits for the user); a printer's figures are the
  sums. A unit that would start more than 14 days after `startAt`, or whose
  piece could not be collected within 60 days after its end, is not placed: it is counted in
  `unplaced` per part.
- **`unattended`** is true when some minute of `[start, end)` has no intervention possible (for
  example a print that runs through the night). Because the start is always an intervention
  minute, "no intervention minute at all" could never be true.
- **Response:** `jobs[]`, `printers[]` (jobs, busy and idle minutes), `totals`, `deadline`
  (`met` is false if anything is unplaced, else `finishAt` day <= deadline day; null without
  a deadline or when there is nothing to place), `unplaced[]`, `warnings[]` (`part_deleted`, `printer_unavailable`,
  `availability_not_configured`, `nothing_to_print`) and the echoed `goal`.

## Assumptions

- **The single human is not modelled.** With several printers the user is assumed to attend all
  of them at once; two handoffs at the same minute are allowed.
- **No batching on a plate yet** (identical pieces sharing a bed): every unit is one print.
- **The goal is ignored** by the naive ordering; it is echoed for display.
- A print is not interrupted by a closed window; only its start and its removal need one.
- A printer starts its next print at the minute it is collected, so idle time is only the wait
  between the end of a print and its collection. The optimiser will try to reduce it.

## Alternatives considered

- **Store the simulation:** it is derived data that depends on four other collections; a stored
  copy would go stale. Computing it takes milliseconds.
- **Import the availability service:** forbidden by ADR 0017; a port keeps modules independent.
- **Minute-by-minute scanning:** simple but wasteful; ranges per day are read once and cached
  during the run.

## Consequences

| Threat                     | Control                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| Amplification (CPU, loops) | At most 1000 units, 14-day horizon, 10 printers, 60-day handoff search |
| Mass assignment            | `z.strictObject`; fields copied one by one in the mapper               |
| Malformed or hostile ids   | 24-hex ids parsed by the schema; no client text reaches a filter       |
| Writes by a read-like call | The module has no repository; no write port exists                     |
| Internal error leaks       | A failing port is a generic 503; the cause is only logged              |
| Anyone local calls it      | EXC-0001: loopback only; no data is changed                            |

- The optimiser (CU08) must return the same shape so the web can show both and compare.
- A date `startAt` more than a few years in the past or future is still valid (2000..2099).
