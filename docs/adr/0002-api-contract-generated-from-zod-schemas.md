# 0002. The API contract is generated from Zod schemas

- **Status:** accepted
- **Date:** 2026-10-13

## Context

The standard requires runtime validation of every input (§5.2), a versioned OpenAPI contract as
the reviewable source of the API (§7.1), and frontend types that match it (§9.3). Maintaining
three hand-written descriptions of the same shapes (validation schema, OpenAPI file, TypeScript
types) guarantees they drift apart, and a beginner will not notice.

## Decision

The **Zod schemas in `apps/api`** are the single source. From them:

1. `@asteasolutions/zod-to-openapi` builds `packages/api-contracts/openapi.yaml`.
2. `@hey-api/openapi-ts` builds `packages/api-contracts/generated/types.gen.ts` from that file.
3. Angular imports types from `@print3d/api-contracts` only.

Both generated files are **committed**, so every API change appears as a diff in the pull
request. `npm run contract` regenerates them; `npm run contract:check` (part of `verify` and CI)
fails when they are stale. Guards refuse hand edits to the generated files.

## Alternatives considered

- **Hand-written OpenAPI first, then generate validators:** the document becomes the source, but
  generated validators are awkward to extend and the YAML is tedious to write and easy to get
  subtly wrong.
- **Hand-written OpenAPI and hand-written Zod, compared by tests:** double the work for the same
  guarantee.
- **Share the Zod schemas with Angular directly:** couples the frontend bundle to backend
  internals (§5.1 forbids sharing internal types) and ships validation code the browser does
  not need.
- **`openapi-typescript`:** the usual choice, but its current release supports only
  TypeScript 5 and Angular 22 requires TypeScript 6. Forcing the install is not acceptable (§8.4).

## Consequences

- One place to change a shape; validation, documentation and frontend types follow.
- The contract is reviewable but not hand-editable. Descriptions and examples are written in the
  schema with `.openapi({ … })`.
- A schema change that is not regenerated fails the gates, which is the intended reminder.
- `@hey-api/openapi-ts` is pre-1.0: it is pinned to an exact version, and an upgrade may change
  the generated output. Only the types plugin is used, which limits the exposure.
- Generated types do not validate anything at runtime in the browser: feature API services
  still narrow responses with type guards.
