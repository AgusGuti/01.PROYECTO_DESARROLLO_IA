---
name: new-api-module
description: Scaffolds a new backend business module in apps/api/src/modules with the full layered file set and tests. Use when adding a new resource or feature area to the Express API (for example printers, filaments, parts, projects, costs, scheduling).
---

# New API module

Creates `apps/api/src/modules/<name>/` in the shape of the reference module
`apps/api/src/modules/health/`. Read that module first, and `.claude/rules/api.md` and
`.claude/rules/data.md`.

`<name>` is the plural resource in English, kebab-case: `printers`, `filaments`, `print-jobs`.

## Files, in the order to write them

| #   | File                            | Contents                                                                                                                                                                     |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `<name>.schemas.ts`             | Zod schemas: create input, update input, list query (page, limit ≤ 100, allow-listed sort), path params (`id` as a 24-hex string), response DTO. `.openapi('Name')` on each. |
| 2   | `<name>.domain.ts`              | Domain type, invariants and pure rule functions. No imports from Express, Mongoose or Zod.                                                                                   |
| 3   | `<name>.domain.spec.ts`         | Unit tests for every rule and boundary.                                                                                                                                      |
| 4   | `<name>.service.ts`             | The use cases. Declares the `Repository` interface it needs. Throws `AppError`.                                                                                              |
| 5   | `<name>.service.spec.ts`        | Unit tests with an in-memory fake repository.                                                                                                                                |
| 6   | `<name>.repository.ts`          | Mongoose schema, indexes, and the repository implementation returning plain domain objects. Maps error `11000` to `AppError('conflict', …)`.                                 |
| 7   | `<name>.repository.int.spec.ts` | Integration tests on `MongoMemoryReplSet`: round trip, uniqueness, pagination, each atomic update.                                                                           |
| 8   | `<name>.mapper.ts`              | Domain object → response DTO.                                                                                                                                                |
| 9   | `<name>.controller.ts`          | `parseInput` → service → mapper → response.                                                                                                                                  |
| 10  | `<name>.routes.ts`              | Router wiring only.                                                                                                                                                          |
| 11  | `<name>.openapi.ts`             | `registerPath` for every route, including error responses with `problemSchema`.                                                                                              |
| 12  | `index.ts`                      | `create<Name>Module(deps)` returning `{ router }`, plus `register<Name>Paths`. Nothing else is exported.                                                                     |
| 13  | `<name>.routes.spec.ts`         | API tests with `createTestApp` and supertest: status codes, validation errors, problem bodies, no leaked fields.                                                             |

## Wire it in

1. `src/app.ts`: `v1.use('/<name>', create<Name>Module({ … }).router)`.
2. `src/openapi/document.ts`: `register<Name>Paths(registry)`.
3. `npm run contract` and commit the regenerated `packages/api-contracts/`.

## Conventions

- `POST /` → `201` + `Location`; `GET /` → paginated `{ items, page, limit, total }` (or cursor);
  `GET /:id` → `200` or `404`; `PATCH /:id` → `200`, `409` on a stale version; `DELETE /:id` → `204`.
- Decide and document the delete policy (hard, soft, blocked while referenced) in the module.
- Ids are strings in DTOs and in the domain type; `ObjectId` stays inside the repository.
- No `ownerId` until authentication exists (EXC-0001); do not invent one.

## Check

`npm run verify:quick`, then `npm run test:int`. `npm run arch` must report no violations: it
enforces the layering this file set expresses.
