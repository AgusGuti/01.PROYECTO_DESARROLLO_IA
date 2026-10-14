# 0008. Edits use an integer version; domain failures answer 400 with issues

- **Status:** accepted
- **Date:** 2026-10-14

## Context

A user can have the same printer open in two tabs and save both. Without protection the second
save silently overwrites the first (a lost update). CU06 is the first editable resource, so the
choice sets the pattern for every module that follows. Separately, some rules involve several
fields at once (a reinforced material needs a hardened-steel nozzle) and the API needs a
consistent answer for them. `AppError` has no 422 code, and CORS already allows `If-Match` and
exposes `ETag`.

## Decision

- **Every editable resource carries an integer `version`**, starting at 1, returned in the
  response. Mongoose's `versionKey` is disabled.
- **`PATCH` requires `version` in the body.** The service reads the document, merges the patch,
  validates the merged state with the domain functions, and then does one atomic
  `findOneAndUpdate` filtered on `{ _id, version, deletedAt: null }` with `$set` and
  `$inc: { version: 1 }`. A null result is re-read only to choose between 404 and 409.
- **A stale version answers 409** `conflict` with an issue whose `path` is `version`; a
  duplicate name answers 409 with path `name`. Clients tell them apart by that path.
- **Cross-field domain failures answer 400** `validation_failed` with `issues`. No 422 is added
  to `AppError`.
- **Order of checks in `PATCH`:** malformed input (400), then missing (404), then an archived
  printer (409), then a stale version (409), then the domain rule on the merged state (400).
  The merged state needs the stored document, so a request that is both stale and breaks a
  domain rule answers 409, not 400.

## Alternatives considered

- **`If-Match` and `ETag` headers:** the standard way, and CORS is ready. A missing header would
  need a 428 code that does not exist, and it is harder for a beginner to debug. It can be added
  later without breaking the body field.
- **Last write wins:** loses edits silently, for example a status change in one tab overwritten
  by an unrelated edit in another.
- **Mongoose `__v`:** only tracks changes to arrays, not to ordinary fields.
- **A transaction around read and write:** one document is involved, so the conditional update
  is enough and cheaper (§4).
- **A 422 status for domain rules:** a new error code and a new convention for the same
  information `issues` already carries.

## Consequences

- No lost updates, with no lock and no transaction.
- Every client must send the version it saw and handle a 409 by reloading; the web shows a
  message offering that.
- Two 409 causes share a status; the distinction by `issues[].path` must be tested on both.
- Every later editable module copies this pattern, so changing it later is expensive.
- Status changes also bump the version, so a stale status change in a second tab is rejected
  rather than applied over newer data.
