# 0024. The intervention schedule is one versioned document, in a fixed time zone

- **Status:** accepted
- **Date:** 2026-10-16

## Context

CU09 (M3.1) defines when the user CAN intervene, for example to change a piece. The optimiser
(M3.4) will consume it and must never need an intervention inside a no-intervention window. The
user has one routine, not one per printer. Agustín decided the model below.

## Decision

- **One schedule for the user**, not per printer. One document in the `availability` collection
  with the fixed string `_id: 'schedule'`, flat apart from bounded embedded arrays (ADR 0012),
  never deleted, with no index beyond `_id`. So `npm run db:indexes` needs nothing for it.
- **Time zone fixed** to `America/Argentina/Buenos_Aires` (UTC-3, no daylight saving). Every time
  is an integer number of wall-clock minutes of that zone, `0..1440`; no time-zone library. A
  planning horizon is at most 14 days, which the optimiser uses later.
- **Content.** `weekly`: exactly 7 entries (0 = Monday ... 6 = Sunday), each a list of ranges
  `{ startMinute, endMinute }` meaning "the user CAN intervene". Ranges are end-exclusive, with
  start < end, sorted, not overlapping (touching is allowed), at most 6 per day. Everything
  outside the ranges is "cannot intervene" (nights). `exceptions`: at most 60 entries
  `{ date, ranges }` that REPLACE that day's weekly ranges; empty `ranges` means no intervention
  that whole day. `date` is a real calendar day `YYYY-MM-DD`, years 2000..2099, no duplicates,
  stored as UTC midnight and returned as `YYYY-MM-DD` (ADR 0011).
- **Defaults** when never saved: every day 08:00-18:00 (480..1080), no exceptions, `version: 0`,
  `updatedAt: null`.
- **Endpoints** (same behaviour as ADR 0021). `GET /api/v1/availability/schedule` returns the
  document or the defaults and never writes. `PUT` is a strict full replacement
  `{ weekly, exceptions, version }`: version 0 does `insertOne` and a duplicate key is 409 on
  `version`; version >= 1 does `findOneAndUpdate({ _id, version })` with `$set` and `$inc`, and a
  null result is 409. Issue paths look like `weekly.2.ranges.1.endMinute` and `exceptions.0.date`.
- **Domain.** `interventionRangesFor(schedule, date)` and `isInterventionPossible(schedule, date,
minute)` are pure, exported by the module's `index.ts`. The weekday comes from the date with UTC
  arithmetic.
- **Human-friendly times** (`08:00`) are the web's job; the API only uses minutes.
- **Deferred, a follow-up:** periods in which a printer is out of use. Not in this change.

## Alternatives considered

- **A schedule per printer:** the user is one person; it would multiply the screens for nothing.
- **A time-zone library or UTC storage:** the zone has no daylight saving, so wall-clock minutes
  are exact and simpler to read.
- **One document per day or per range:** unbounded growth and no atomic replacement.
- **Create the document on `GET`:** a `GET` that writes (see ADR 0021).

## Consequences

- Threats (EXC-0001 is in force: anyone who can reach the local API can change the schedule).

| Threat                  | Control                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Mass assignment         | `z.strictObject` everywhere; fields copied one by one in the repo |
| Oversized arrays        | 7 days exactly, 6 ranges per day, 60 exceptions; integers 0..1440 |
| Overlapping or reversed | The schema rejects them with the exact field path                 |
| Concurrent edits        | `version` in the filter; unique `_id` decides two first saves     |
| Anyone local edits it   | EXC-0001: loopback only; a schedule has an owner once auth exists |

- Changing the time zone later is a data migration.
- The optimiser must treat the end of a range as exclusive.
