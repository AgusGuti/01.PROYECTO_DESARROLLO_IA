# 0016. A project is one document with embedded lines that reference parts by id

- **Status:** accepted
- **Date:** 2026-10-15

## Context

CU01 registers a print project with a name, description, priority, optional deadline and the parts
it needs with a quantity each. ADR 0013 said projects reference parts and that CU03, CU04 and CU07
snapshot the values they compute from. Agustín confirmed the four priority levels.

## Decision

- A project is one document in `projects`. Its lines `{ partId, quantity }` are embedded (bounded
  at 100, always read with the project, no lifecycle of their own). A line **references** the part
  by id and never copies its values.
- Fields and limits:

  | Field         | Rule                                                                                      |
  | ------------- | ----------------------------------------------------------------------------------------- |
  | `name`        | text 1..100 code points, no control characters, trim, NFC; not unique                     |
  | `description` | optional single line 1..1000; `null` clears it                                            |
  | `priority`    | `low`, `normal`, `high`, `urgent`; default `normal`                                       |
  | `deadline`    | optional calendar date `YYYY-MM-DD` (ADR 0011), years 2000..2099; `null` clears           |
  | `items`       | 0..100 lines, `quantity` integer 1..1000, no repeated `partId`; replaced whole on `PATCH` |

- A past deadline is allowed: registering an overdue project is legitimate and a deadline is a
  plan, not a fact. An empty project is allowed ("create it, then add parts").
- There is **no project status** yet; the queue (CU07) will bring one.
- Every `partId` must be a live part at write time, otherwise 400 with an issue on
  `items.N.partId` (N is the position, in the dotted format the shared `parseInput` produces). A
  repeated part gives the same path on its second occurrence. The check runs after the
  stale-version check: 400 schema, 404, 409 stale, 400 domain, atomic write (ADR 0008).
- The detail returns each line with the current part name and material, or `part: null` when the
  part is no longer live (the UI shows "Pieza eliminada" and forces its removal before saving).
  The list returns summaries (`itemCount`, `unitCount`) and needs no part lookup.
- **List:** filter `priority`; sort `deadline | priority | name | createdAt`, default `createdAt`
  descending. Priority sorts by rank (low, normal, high, urgent), computed in the aggregation with
  `$indexOfArray`, not stored. Projects without a deadline come last in both directions. Every
  sort has an `_id` tiebreak in the same direction.
- Removal is logical (`deletedAt`); a repeated `DELETE` is 404. No secondary index: the list sorts
  on a computed key and the collection holds tens to hundreds of documents (ADR 0012). A multikey
  index on `items.partId` is not justified until `explain` shows a real cost.
- In the browser, "overdue" is the deadline text strictly before **today's local date**, compared
  as `YYYY-MM-DD` strings. The server rule "not in the future" of ADR 0011 does not apply to a
  deadline, and a user in UTC-3 must not see a project due today as overdue after 21:00.

## Alternatives considered

- **Copy the part values into each line:** rewrites history and goes stale.
- **A stored `priorityRank`:** derived data that must stay in step on every write.
- **Alphabetical priority:** wrong meaning ("urgent" before "normal").
- **Reject past deadlines:** blocks legitimate registration and editing an old project.
- **A `project_items` collection:** the lines are bounded and always read together.
- **Unique project names:** brings the printers machinery (ADR 0009) for a convenience.

## Consequences

- CU04 and CU07 snapshot the values at quote or queue time and treat `part: null` as "cannot
  compute".
- A project can in theory hold a line to a deleted part (see ADR 0018).
- The planning time zone for the deadline remains an open question for M3.
