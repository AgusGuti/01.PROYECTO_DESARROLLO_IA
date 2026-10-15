# 0009. Deleted printers keep their name; archived can be unarchived, deleted can be restored

- **Status:** accepted
- **Date:** 2026-10-14

## Context

ADR 0006 made removal logical and let a deleted printer **release** its name through a partial
unique index. Agustín then asked for two things: an archived printer ("pending deletion") must be
able to come back, and a deleted printer must be restorable, but only when someone tries to
create a printer with the name it still holds. That second rule means a deleted printer's name
must stay reserved, otherwise there would be nothing to detect.

## Decision

- **Name reservation** (supersedes the "deleted releases the name" part of ADR 0006): the unique
  index on `name` is no longer partial. It is `printers_name_unique`: unique, collation `es`
  strength 2, no `partialFilterExpression`. Live, archived and deleted printers all reserve their
  name. Everything else in ADR 0006 stands.
- **Unarchive:** `POST /api/v1/printers/:id/unarchive` clears `archivedAt` with one conditional
  update (`deletedAt: null`, `archivedAt` not null) and bumps `version`. On a printer that is not
  archived it is an idempotent 200. A missing or deleted printer is 404.
- **Restore, only on a name clash:** `POST /api/v1/printers` takes an optional
  `restoreIfDeleted` flag (default false, not stored).
  - Name held by a deleted printer and no flag: 409 with issue path `restoreIfDeleted`. The UI
    asks the user whether to restore it. The response carries no id and none of the old data.
  - Same request with `restoreIfDeleted: true`: one atomic update on the deleted printer sets
    the **submitted** data, clears `deletedAt` and `archivedAt`, bumps `version`, and answers
    200 (a create answers 201). The restored printer takes the new data, not the old.
  - Name held by a live or archived printer: 409 with path `name`, as before.
  - The domain rule on reinforced materials runs before any restore.
- There is no `POST /:id/restore` by id: a restore is only reachable through an attempt to create
  with the clashing name, which is what Agustín asked for.

## Alternatives considered

- **Keep the partial index and create a new printer when the name belongs to a deleted one:**
  nothing to detect, so a deleted printer could never be restored. Rejected by the requirement.
- **`POST /:id/restore` by id:** restores without any name clash, which is not what was asked,
  and needs a way to list deleted printers.
- **Restore silently, without asking:** the user may really want a new printer with the same
  name; restoring would overwrite nothing but would resurrect an old record unexpectedly.
- **Restore keeps the old data:** surprising, since the user just typed new data.
- **A `409` with the deleted printer's id and data:** leaks information about a record the user
  was told no longer exists, and nothing in the flow needs it.

## Consequences

- A user can no longer reuse the name of a deleted printer by creating a new one: they restore
  it (with new data) or rename it first. The earlier "ghost names" objection to a full unique
  index is answered by the restore prompt.
- Deleted documents accumulate and keep their names forever. Revisit with a retention policy if
  that ever matters.
- The old partial index `printers_name_live_unique` may still exist in a development database.
  It is weaker than the new one and harmless; drop it by hand when convenient. `npm run
db:indexes` creates the new index and never drops anything.
- Two simultaneous restores of the same name: one wins with 200 and the other gets 409 `name`,
  because the winner made the printer live. The conditional update decides, not a prior lookup.
- The client tells the three 409 causes apart by the issue path (`version`, `name`,
  `restoreIfDeleted`), following ADR 0008.
