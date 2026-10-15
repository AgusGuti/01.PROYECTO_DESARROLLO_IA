# 0010. Stock is consumed with one conditional atomic decrement

- **Status:** accepted
- **Date:** 2026-10-14

## Context

Roadmap M1.2 (CU05) is the first place where a value decreases and two requests may race for the
same stock. The data rules say to decrement only where enough remains, with one conditional
atomic update and no read-modify-write. A filament can also be edited from a form that stays
open for a while, and editing `availableGrams` on a stale form must not silently erase a consume
the user never saw.

## Decision

- `POST /api/v1/filaments/:id/consume` with `{ grams }` runs one `findOneAndUpdate` filtered on
  `{ _id, deletedAt: null, availableGrams: { $gte: grams } }`, with `$inc` of
  `availableGrams: -grams` and `version: 1`, and `$set` of `updatedAt`. It answers 200 with the
  updated filament.
- On a miss, one read classifies the cause: missing or deleted is 404, anything else is 409 with
  issue path `grams` and a message with no numbers. Nothing is changed.
- Consume takes **no** `version` in its body and none in its filter: decrements commute, so two
  quick consumes never conflict with each other.
- Consume **does** bump `version` and `updatedAt`, so every write follows one rule. A `PATCH`
  built before the consume carries the old version and gets a 409, which is correct because
  `availableGrams` changed. A `PATCH` on the new version runs against the new state, so the
  merged-state check (`availableGrams <= initialGrams`) is exact.
- There is no refill or return operation. A physical correction (weighing the spool) goes
  through `PATCH` on `availableGrams`, never above `initialGrams`. A "return unused material"
  operation can be added when the print queue (CU07) needs it.

## Alternatives considered

- **Read, subtract, save in the service:** two simultaneous requests both read 100 g and both
  subtract 30, losing one decrement, or both pass a check that only one should.
- **A transaction:** one document is involved, so the single conditional update is enough and
  cheaper.
- **A `version` filter on consume:** two quick consumes of different amounts would answer 409 to
  each other for no reason.
- **No version bump on consume:** the invariant would survive only because consume decreases
  stock, and a stale edit could still overwrite a consume it never saw.
- **A reservation or ledger collection:** nothing defines a reservation until CU07.

## Consequences

- N parallel consumes that together exceed the stock leave exactly the ones that fit
  succeeding, and `availableGrams` never goes below zero. This is proven against a real MongoDB
  replica set, not a mock.
- A user with the edit form open who changes only the colour also gets a 409 after a consume. The
  form offers to reload, and a single user rarely consumes while editing.
- On a 409 the client must read the filament again to say how much is left, because the error
  carries no numbers.
- Between the failed write and the classifying read the stock may change. The answer is still
  409 and the user can retry.
- Consume is a non-idempotent `POST`: the web never retries it automatically and reloads after
  any error.
