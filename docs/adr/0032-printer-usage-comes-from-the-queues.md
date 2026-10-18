# 0032. A printer is in use when a queue with pending work selects it

- **Status:** accepted (completes the seam left open by 0006 and 0025)
- **Date:** 2026-10-18

## Context

ADR 0006 made the printers service ask a `PrinterUsageCheck` before removing a printer: in use
means archive, idle means delete. Until now the check was a stub that always answered false. ADR
0025 stores the printers a queue selects in `printerIds`, so the real answer exists.

## Decision

- A printer is **in use** when some queue lists its id in `printerIds` and has at least one line
  with `completed < quantity`. A finished queue (every line completed) or a queue without lines
  does not hold a printer. The manual `in_use` status still counts, as in 0006.
- The printers module keeps owning the port (`PrinterUsageCheck`, ADR 0017). The queues module
  provides it with `createPrinterUsageCheck(repository)`; `app.ts` wires it. No module imports
  the other.
- One query, `QueueRepository.hasPendingWorkFor(printerId)`: equality on `printerIds` plus an
  `$expr` over the embedded lines (at most 100 per queue).
- **New index** `queues_printer_ids` (multikey, non-unique) on `printerIds`. ADR 0025 said "no
  index beyond `_id`" because every query was by `_id`; this is the first query by printer, so
  without it each printer removal would scan the whole collection. It is created by
  `npm run db:indexes` (runbook updated). It is not checked at startup: a missing index only makes
  the query slower, it cannot corrupt data.
- **Fail closed:** if the query fails the check rejects, the service does not delete, and the
  client gets a 503. A printer is never deleted when the answer is unknown (unchanged from 0006).
- An archived printer still cannot be selected for a queue (0025), so an archived printer's
  pending work can only shrink.

## Consequences

- Removing a printer used by an unfinished queue archives it; removing an idle one deletes it.
- Still open: 0006's last step, turning an archived printer into a deleted one when its queue
  finishes, has no trigger yet. It stays "pending deletion" until a later change (for example
  after a queue edit that completes the last line) does it, or the user removes it again after
  the work is done: a repeated `DELETE` on an archived printer is still an idempotent 204 that
  changes nothing.
- The check and the removal are not atomic (0006 accepted this for a single user).
