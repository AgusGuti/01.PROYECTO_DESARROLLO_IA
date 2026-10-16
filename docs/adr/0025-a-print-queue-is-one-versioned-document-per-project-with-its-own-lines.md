# 0025. A print queue is one versioned document per project, with its own lines

- **Status:** accepted
- **Date:** 2026-10-16

## Context

CU07 (M3.2) selects the pending pieces of a project into the input of the optimiser (CU08, M3.4).
Agustín decided: one queue per project; completed pieces stay visible inside an ongoing project
(progress per line); single or multi printer, and the optimisation goal, are chosen per project;
per-job priority and restrictions are out of scope for v1 (the project already has a priority).

## Decision

- **Collection `queues`, `_id` = the project id** (24-hex string). "At most one queue per project"
  is the unique `_id` index, not a prior lookup (standard §4); there is no other index.
- **Fields:** `goal` (`deadline` | `fastest` | `minimal_idle`), `mode` (`single` | `multi`),
  `printerIds` (single: exactly 1; multi: 2..10; distinct), `lines` (0..100, unique `partId`,
  `quantity` 1..1000, `completed` 0..`quantity`), `version`, `createdAt`, `updatedAt`.
  Lines are embedded: bounded and always read together.
- **Lines are a snapshot.** At creation they are copied from the project items (with `completed:
0`) or given by the user. They are edited on the queue and are **not synced** with later edits
  of the project: the queue records what is planned and how much is done; the project records what
  was asked. Re-syncing, if wanted, is a deliberate follow-up.
- **References are ports, consumer-owned** (ADR 0017), built in `app.ts`: a project reader, a
  batch part lookup (name and print time of the live parts, one query) and a printer lookup. A
  port that fails is a 503, never "does not exist". An **archived printer cannot be selected** in
  a new selection; a stored printer archived later does not block an unrelated edit, because only
  the printers of the patch are checked.
- **Endpoints** under `/api/v1/queues`, all strict:
  - `POST` `{ projectId, goal, mode, printerIds, lines? }`: 201 with `Location`. A missing or
    removed project, a missing part or an unusable printer is 400, all issues at once with
    indexed paths (`projectId`, `lines.2.partId`, `printerIds.1`). A second queue for a project is
    409 with issue path `projectId` (duplicate `_id`, code 11000). Two simultaneous creates: exactly
    one wins.
  - `GET /:projectId`: 200 or 404. Each line adds `partName`, `estimatedPrintSeconds`,
    `pendingUnits` and `partDeleted`; `totals` has `totalUnits`, `completedUnits`, `pendingUnits`,
    `pendingSeconds`. Lines of a deleted part count their units but 0 seconds.
  - `PATCH /:projectId`: `version` required plus any of `goal`, `mode`, `printerIds`, `lines`
    (replaced whole). Precedence: 400 (schema) -> 404 -> 409 stale -> 400 (domain, on the merged
    result, for example `mode: multi` while the stored selection has one printer). One
    `findOneAndUpdate({ _id, version })` with `$set` and `$inc`.
  - `DELETE /:projectId?version=N`: 204. A hard `deleteOne({ _id, version })`: the queue is derived
    data and can be created again, so there is no soft delete. A miss is 404 or 409.
- **Domain** (pure): `pendingOf`, `lineIssues`, `printerSelectionIssues`, `queueTotals`. Sums are
  safe-integer checked; an overflow (unreachable with part limits) is a generic 500.
- **Out of scope:** per-job priority and restrictions; deleting the queue when its project is
  removed (an orphan queue is harmless and is reached only by its id); the printers' "has
  assignments" check (ADR 0006), which can now be answered from `printerIds` in a follow-up.

## Alternatives considered

- **A queue per job or per piece:** much more data and no use until the optimiser exists.
- **Auto-sync with the project:** hides user edits of the queue and needs rules for conflicts.
- **A separate `queueId`:** a second identifier and a lookup to enforce one queue per project.
- **Soft delete:** the queue is derived; keeping it only adds states to reason about.

## Consequences

- Threats (EXC-0001 is in force: anyone who can reach the local API can read or change a queue).

| Threat                        | Control                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| IDOR by id while EXC-0001     | Accepted: loopback only; ownership checks arrive with authentication   |
| Mass assignment               | `z.strictObject` everywhere; fields copied one by one in the repo      |
| Oversized arrays              | 100 lines, 10 printers, quantities 1..1000; batch lookup, never N+1    |
| Operator or odd ids           | 24-hex regex on every id, lower-cased; filters built from named fields |
| Two simultaneous creates      | Unique `_id`: one 201, one 409; no check-then-insert                   |
| Lost update or edit vs delete | `version` in the filter of `PATCH` and `DELETE`; a miss is 404 or 409  |
| Error detail leak             | Driver and port errors become a generic 503; problem details only      |

- The optimiser (M3.4) reads the queue and treats `completed` lines as done.
- Changing the stored shape later needs a migration (expand, migrate, contract).
