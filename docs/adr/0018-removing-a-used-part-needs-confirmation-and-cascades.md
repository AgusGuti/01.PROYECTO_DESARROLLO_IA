# 0018. Removing a part that live projects use needs confirmation and cascades

- **Status:** accepted
- **Date:** 2026-10-15

## Context

ADR 0013 left a "part in use" check for CU01. Agustín decided: deleting a part used by projects is
blocked with a notification; if he confirms, the part is removed from those projects and then
deleted.

## Decision

- `DELETE /api/v1/parts/:id` on a part used by one or more live projects answers **409** with a
  fixed message and one issue with path `projects`. It carries no project names or counts.
- `GET /api/v1/parts/:id/usage` answers `{ total, projects: [{ id, name, quantity }] }`, at most 50
  entries sorted by name then `_id`, with the true `total`. The web calls it after the 409 to show
  the dialog. A missing or deleted part is 404.
- `DELETE /api/v1/parts/:id?removeFromProjects=true` is the confirmation. A flag on the query, not
  a body: `DELETE` with a body is awkward and some proxies drop it. With the flag and an unused
  part it simply deletes. The query is strict.
- **Cascade:** one `updateMany` that `$pull`s the part's lines from the **live** projects, bumping
  each project's `version` and `updatedAt`, **then** the conditional soft delete of the part. A
  project being edited at that moment gets 409 on `version`, which is correct.
- **Order and failure modes.** Pull first: a failure in between leaves a live part with no lines
  (benign; the retry finds less usage and the pull is idempotent, and the client sees 503). Delete
  first would leave dangling lines in live projects with no way back (the retry answers 404).
- **No transaction.** The invariant spans two documents, but the writes belong to two modules, so a
  shared session would couple their public surfaces, and it would not close the real race anyway
  (a project write that already validated the part does not read the part inside the transaction).
- **Residual race, accepted:** a project created or edited to include the part between the pull and
  the soft delete leaves a dangling line. The window is one database round trip and needs two
  concurrent requests from the same single user on loopback (EXC-0001). Defence in depth: the
  project detail returns `part: null` for such a line, the UI shows "Pieza eliminada" and blocks
  saving until it is removed, and CU04 and CU07 treat it as "cannot compute".
- The same window exists without the flag: the usage check finds no project, a project then adds the
  part, and the soft delete runs. The read-side `part: null` covers both.
- A part lookup that fails **after** a project write has committed (a `PATCH` without `items`)
  answers 503 although the write happened; the client retries with the old version and gets 409.
  This needs two failures in a row and is accepted.
- Soft-deleted projects keep their old `partId`s; nothing reads them and the cascade ignores them.

## Alternatives considered

- **Project names inside the 409 body:** mixes data into errors; the safe-error rule says no.
- **A separate "force" endpoint:** a second way to do the same thing.
- **A transaction across both writes:** coupling without a real gain.
- **Delete first, then pull:** dangling lines with no repair.
- **Blocking until the user edits every project:** he asked for the cascade.
- **Physical delete:** contradicts the logical-removal ADRs.

## Consequences

- Deleting a used part takes two requests in the web (the plain `DELETE`, then the confirmed one),
  which matches the flow Agustín described.
- A later queue (CU07) that holds a job for the part will need its own blocking rule.
- Projects written by the cascade change their `version`, so open edit forms get a reload prompt.
