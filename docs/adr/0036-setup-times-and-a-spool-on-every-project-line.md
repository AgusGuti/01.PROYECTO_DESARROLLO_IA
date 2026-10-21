# 0036. Setup times between prints, and a spool on every project line

- **Status:** accepted
- **Date:** 2026-10-21

## Context

The naive simulation (CU10, ADR 0026) and the optimiser (CU08, ADR 0028) start a print the moment
the previous one on the same printer is collected. In practice the person has work to do between
two prints: clean the bed and reheat (about 10 minutes), and change the spool when the next print
uses a different one (about 30 minutes more). Nothing in the data said which spool a print uses:
parts, project lines, queue lines and printers carried no filament. Agustín asked for both times
to be part of the planning, for a spool to be assigned to each piece of a project, and for the
same part to be allowed on several lines with different spools.

## Decision

- **Two planning settings** join `batchSavingBasisPoints` in the document of ADR 0027:
  `printerTurnaroundMinutes` (default 10) and `filamentChangeMinutes` (default 30), integers
  0..240. `PUT` stays a full replace, so both are required. A stored document without them (saved
  before this ADR) reads as the defaults: the change is expand-only and needs no migration script.
- **A spool on every line.** A project line becomes `{ partId, filamentId, quantity }` and a queue
  line `{ partId, filamentId, quantity, completed }`. The spool is **mandatory when a project is
  created or saved** and when a queue is created. Stored lines from before this ADR have no spool
  and read as `filamentId: null`: they still open and simulate ("unknown spool", no filament change
  counted), but they cannot be saved until every line has a spool. A stored `null` is therefore a
  legacy state that disappears as projects are edited, not a normal value.
- **A part may repeat** on several lines with different spools. The unique key of a line is the pair
  `(partId, filamentId)`. It is a domain rule in the services, because a MongoDB unique index cannot
  express "unique inside an embedded array"; the existing `version` guard covers concurrent writers.
  A project that uses a part now sums the quantities of all its lines.
- **Scheduling model.** For a job that is not the first of its printer:
  `setup = turnaround + (previous and current spools both known and different ? filamentChange : 0)`.
  The setup starts at the intervention minute where the printer is collected
  (`setupStart = nextIntervention(free)`; the handoff already is one), and the print starts after it
  (`start = setupStart + setup`), without being moved to another intervention minute because someone
  attended the setup. A job whose setup runs past the attended window is `unattended`, measured from
  `setupStart`. The first job of a printer has no setup (the loaded spool is unknown), and nothing is
  added after the last one. Setup is neither busy nor idle time: for each printer the time from one
  handoff to the next is `setup + busy + idle`, and setup shows in `finishAt`. With both settings at
  0 the schedule is the one of ADR 0026 and 0028.
- **Reporting.** Jobs expose `filamentId`, `setupMinutes` and `filamentChanged`; printers and the
  totals expose `setupMinutes` and `filamentChanges`.
- **The optimiser** keeps lines apart per `(part, spool)`, so a plate never mixes spools. It gets a
  sixth strategy, `group_by_spool`, which prefers the option that needs no spool change, and
  `filamentChanges` becomes the last element of every goal key, so fewer changes breaks a tie but
  never beats an earlier criterion. `naive` stays first and wins ties, so the answer is still never
  worse than the baseline.
- **Stock warnings never block.** The simulation adds `filament_insufficient` when the pending
  pieces of the lines that share a spool weigh more than the spool's current `availableGrams`
  (the reply lists how many pieces fit and how many remain), and `filament_deleted` when a line's
  spool no longer exists (the line is then treated as "unknown spool"). A queue line that has printed
  pieces cannot change its spool: the user splits the line (a second line of the same part, the
  remaining quantity, another spool).
- **A deleted spool is not blocked.** The screens that show a line whose spool is gone offer a
  dialog to choose another existing spool or go to create one; only saving is held.

## Alternatives considered

- **A spool per part or per printer:** the same part is printed in different colours in different
  projects, and a printer holds different spools over time.
- **A required spool with a data migration now:** old projects would have to be fixed before the
  system works; the legacy `null` costs one `?? null` and lets the user assign spools gradually.
- **Constant setup times in code:** invented numbers the user cannot adjust (as in ADR 0027).
- **Setup counted as idle or busy time:** it would distort the idle-time goal of the optimiser.
- **A solver for spool grouping:** the greedy strategies of ADR 0028 are enough and explainable.

## Consequences

- With the defaults the plans are longer than before, which is the point: the estimate now includes
  work that was always there.
- The assistant and every fixture that builds a project or queue line must
  supply a spool.
- The weight of a part is `estimatedWeightGrams`; the warning is as good as the weights entered.
- Deducting stock when pieces are marked printed (and restoring it on undo) is a separate decision,
  taken in its own ADR.
- Amends ADR 0016 (project lines), 0025 (queue lines), 0027 (settings) and 0028 (strategies).
