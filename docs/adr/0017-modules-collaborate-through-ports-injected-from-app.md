# 0017. Modules collaborate through ports injected from app.ts

- **Status:** accepted
- **Date:** 2026-10-15

## Context

`projects` must check and read parts, and `parts` must know which projects use a part. Imports in
both directions would be a cycle, and the dependency rules forbid reaching into another module's
internals. `printers` already receives a `hasAssignments` function from outside (ADR 0006).

## Decision

- The **consumer owns the port type** and the provider implements it structurally:
  - `PartLookup` (owned by `projects`): given part ids, returns the live ones with their name and
    material in a single `$in` query (no N+1). An id missing from the result is unknown or deleted.
  - `PartUsage` (owned by `parts`): lists the live projects that use a part, and removes a part
    from them.
- `app.ts` is the only place that knows both: it creates the lookup from the parts repository,
  creates the projects module with it, and creates the parts module with the usage port the
  projects module exposes. `parts` and `projects` import neither each other nor their internals.
- `createPartsModule` **requires** `partUsage`. A default of "nothing is used" would fail open: a
  delete would skip the confirmation and leave projects pointing at a deleted part. (`printers`
  still defaults `hasAssignments` to `false`; revisit it when CU07 gives it a real provider.) Tests
  that build the app pass a fake through `createTestApp`.
- Where a port fails, the operation fails closed (503) and changes nothing.

## Alternatives considered

- **`$lookup` or a shared Mongoose model:** the projects repository would need the parts
  collection name and shape.
- **Each module importing the other's `index.ts`:** a cycle.
- **A shared "core" module or an event bus:** a new layer or pattern without a demonstrated need.
- **A per-line lookup:** N+1 queries.

## Consequences

- A structural mismatch between provider and consumer shows up only where `app.ts` wires them, so
  the app-level integration test must exercise the real wiring.
- CU07 will also depend on parts and will implement its own usage provider; `app.ts` will then
  compose several providers (a list or a small combinator). Decide it when CU07 starts.
