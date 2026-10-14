# 0006. Printers are removed logically; names are unique among live printers

- **Status:** accepted (the "deleted releases the name" part is superseded by 0009)
- **Date:** 2026-10-14

## Context

CU06 needs a way to remove a printer. Later use cases (the print queue, CU07) will assign jobs to
printers, so a printer that is removed while it still has work must not break those jobs. Agustín
decided that removal is never physical, and that a printer in use or with assignments stops
accepting new work and is removed automatically when its queue finishes. Printer names must be
unique without distinguishing case, and a removed printer must not block reusing its name.
`autoIndex` is off in production (`apps/api/src/infrastructure/database/mongo.ts`), so indexes
there are created by a deliberate step, not by Mongoose on its own.

## Decision

- **Removal is always logical.** A document is never deleted from the collection.
- **Idle printer** (`status` is not `in_use` and `hasAssignments(id)` is false): set `deletedAt`.
  It disappears from lists and answers 404 everywhere.
- **Printer in use or with assignments:** set `archivedAt`. _Archived_ is a transitional state,
  "pending deletion": the printer accepts no new assignments, stays **visible** in lists and
  `GET` with `archivedAt` set (the UI labels it "Pendiente de eliminar"), and rejects `PATCH`
  with 409. A repeated `DELETE` on it is an idempotent 204. CU07 sets `deletedAt` when its queue
  finishes. It is not a way to keep a printer for history. Showing it explains why its name is
  still taken.
- **The seam:** the service takes `hasAssignments: PrinterUsageCheck`, defaulting to
  `async () => false` with a comment pointing to CU07, which will implement it and complete the
  archived-to-deleted step. The user can mark a printer `in_use` by hand, so the archive path is
  reachable over HTTP already, and until CU07 nothing finishes an archived printer: it stays
  "pending deletion", cannot be edited and keeps its name. Agustín accepted this; the web dialog
  warns about it before an in-use printer is removed and the result message says "pendiente de
  eliminar" instead of "eliminada".
- **Uniqueness:** a unique index on `name` with collation `{ locale: 'es', strength: 2 }` and
  `partialFilterExpression: { deletedAt: { $type: 'null' } }`. A deleted printer releases its
  name; an archived one keeps reserving it. `deletedAt` and `archivedAt` are written as an
  explicit `null` on create so the partial index matches.
- **Production:** the index is created with `npm run db:indexes` on every deploy, before the API
  starts (runbook `docs/runbooks/database-indexes.md`). It is never created automatically at
  startup (data rules), but the API **refuses to start** in production when the unique index is
  missing, so forgetting the step cannot silently allow duplicate names.
- **No `$jsonSchema` validator** on the collection yet: Zod, the domain functions and the unique
  index guard the data, and the repository is the only writer.

## Alternatives considered

- **Physical delete:** loses the record while jobs may still reference it, and contradicts the
  confirmed requirement.
- **One boolean flag (`removed`):** cannot tell "gone" from "finishing its queue before it goes".
- **A non-partial unique index:** a deleted printer would keep its name forever, and the user
  could never register it again without knowing why.
- **A `nameLower` field:** duplicates data that can drift; the collation gives the same result
  inside the index.
- **Looking up the name before inserting:** two simultaneous requests both pass the lookup. The
  index is the only race-free check (§4).
- **A `$jsonSchema` validator from day one:** a second layer of rules with a single writer; the
  cost is not yet justified.

## Consequences

- Removal needs no data migration later, and history stays intact.
- Every query for "live" printers must filter `deletedAt: null`; archived printers are included
  and counted in `total`. The repository owns that filter so callers cannot forget it.
- Queries sorting by name must pass the same collation to use the index.
- There is a short window between "has assignments?" and the update: they touch different
  collections and are not atomic. It is accepted for a single user. CU07's ADR decides whether
  creating an assignment needs a transaction or a re-check that the printer is still live.
- Deleted documents accumulate. At this scale (tens of printers) it does not matter; revisit if
  that changes.
- A beginner reading the index definition may not expect the collation or the partial filter:
  the schema carries a comment explaining both.
