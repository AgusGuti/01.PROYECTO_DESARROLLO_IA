## What and why

<!-- The problem, and how this change solves it. Link the use case (CU01–CU10) if there is one. -->

## How it was verified

<!-- Paste the summary printed by `npm run verify`. Say plainly if anything was not run. -->

## Checklist (standard §16)

- [ ] Layer and module boundaries respected; no unnecessary complexity added
- [ ] Inputs validated at runtime; no mass assignment or unsafe query construction
- [ ] Tests cover success, invalid input and failure paths
- [ ] Concurrency, uniqueness and idempotency considered where data is written
- [ ] API contract regenerated if schemas changed (`npm run contract`)
- [ ] Errors and logs expose no secrets or internal details
- [ ] New dependency, pattern or exception? Linked ADR / `EXC-NNNN`:

## Risks, trade-offs and rollback

<!-- API, schema, environment-variable or migration changes. How to undo this if it goes wrong. -->
