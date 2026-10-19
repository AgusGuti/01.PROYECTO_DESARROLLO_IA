# 0033. Absences live in the intervention schedule and override everything

- **Status:** accepted (extends 0024; the planner reads it as in 0026 and 0028)
- **Date:** 2026-10-19

## Context

The user is sometimes away for several days (holidays, a trip). The weekly ranges and the date
exceptions of ADR 0024 can express that only one day at a time, 60 exceptions at most, and an
exception with ranges would still allow intervention. The planner must not start or collect a
print on those days.

## Decision

- The schedule document gains `absences`: 0..30 entries `{ from, to }`, `YYYY-MM-DD`, both days
  **inclusive**, real calendar days in 2000..2099 (same rule as exception dates), `from <= to`.
  No new module and no new collection: the whole document is still read and replaced together
  and the array is bounded, so it stays embedded (ADR 0024).
- Entries must be sorted by `from` and must not share a day. `10-12` followed by `13-15` is
  allowed; `10-12` followed by `12-15` is not.
- **Semantics:** on any day inside an absence there is no intervention at all. It overrides the
  weekly ranges AND the date exceptions. `interventionRangesFor` answers `[]` and
  `isInterventionPossible` false, so `createTimeline` (ADR 0026/0028) needs no change: a print that
  ends inside an absence is collected at the first intervention minute after it, and a start that
  falls inside one moves after it. If that pushes the start past the 14-day horizon the unit is
  reported as unplaced.
- **Storage:** UTC-midnight `Date`s, as exceptions (ADR 0011); returned as `YYYY-MM-DD`.
- **Old documents:** a document saved before this change has no `absences` field. The repository
  reads it as `[]` and `GET` answers `absences: []`; the default at version 0 is also `[]`. No
  migration: the field appears on the next save.
- **Contract change:** `PUT /availability/schedule` now **requires** `absences` (strict body, a
  missing field is a 400). This is deliberate: the web always sends the full document and a
  silent default would let a client erase absences it never saw. The response gains `absences`.
  The only consumer is the web app of this repository; it is updated in the same release.
- Issue paths: `absences.N.to` when `to` is before `from`, `absences.N.from` for an overlap or
  wrong order, `absences` for more than 30 entries, `absences.N.from|to` for an invalid date.
- `ScheduleRules` (the type the simulations module receives through `createScheduleReader`) now
  carries `absences`.

## Consequences

- A long absence is one entry instead of dozens of exceptions.
- Overlap and order are validated in the schema only; the repository trusts the service input
  (the same as ranges and exceptions) and enforces just the length of 30.
- The optimiser's "never worse than naive" property test now also draws random absences.
