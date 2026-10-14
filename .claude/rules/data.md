---
paths:
  - 'apps/api/src/**/*.repository.ts'
  - 'apps/api/src/**/*.domain.ts'
  - 'apps/api/src/infrastructure/database/**'
  - 'apps/api/migrations/**'
---

# Data rules (MongoDB + Mongoose)

Standard §4. Agustín knows MongoDB; explain the Mongoose and Node side, not MongoDB basics.

## Modelling

- Decide **embed vs reference** per relationship and write the reason in the module's ADR or a
  comment at the schema. Embed what is read together and bounded; reference what grows without
  limit, is shared, or changes on its own. No unbounded arrays.
- A part is reused across projects (CU02), so a project _references_ parts and stores the
  quantity; it does not copy the part.
- A confirmed schedule or a cost quote is a **snapshot**: copy the values it was computed from,
  so later edits to a part or filament do not rewrite history. Say so at the schema.
- State every invariant: uniqueness, allowed states and transitions, ranges, what deleting does
  to references. Each invariant gets a test.
- Store instants as UTC `Date`. Store durations as integer seconds, weights as integer
  milligrams or grams, money as integer minor units. No floats for quantities that are summed.

## Integrity

- Uniqueness is a **unique index**. A "does it exist?" query before inserting does not stop two
  concurrent requests. Catch duplicate-key error `11000` and throw `AppError('conflict', …)`.
- Mongoose validation is not a database constraint. Indexes and, where it matters, a
  `$jsonSchema` validator are.
- Avoid read-modify-save. Use one conditional atomic update, for example decrement filament
  stock only `where remainingGrams >= needed`, and treat "no document matched" as a conflict.
- For edits by a user, use optimistic concurrency: a `version` field in the filter and `$inc`.
- A transaction only when one operation must change several documents together. Keep it short,
  with no HTTP calls inside. The driver may run the callback again, so it must be repeatable.

## Queries

- Build filters from validated, named fields. Never spread client input into a filter, and never
  accept operator keys (`$…`) from a client.
- Every list query has a `limit`, a projection and a deterministic sort. For data that grows,
  page by a key (`_id` or a sort key), not a deep `skip`.
- Add an index for a real query, and say which query in a comment. Check new or changed queries
  with `explain('executionStats')`: no unexpected `COLLSCAN`.
- Return plain objects from repositories (`.lean()` plus an explicit mapping to the domain type).

## Change

- A schema change that old code cannot read is a migration: expand → migrate → contract.
  Migrations are versioned scripts run deliberately, never automatically at startup.
- Never drop a collection, database or volume, and never run a destructive migration, without
  Agustín's explicit approval for that specific action.
- Integration tests run against a real replica set (`MongoMemoryReplSet`), never a mock.
