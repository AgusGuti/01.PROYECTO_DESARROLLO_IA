---
paths:
  - 'apps/api/**/*.ts'
---

# API rules (Express 5 + TypeScript)

Standard §6 and §7. `apps/api/src/modules/health/` is the reference module.

## Shape of a request

1. Route → controller method. No logic in the route file.
2. Controller: `parseInput(schema, req.body | req.query | req.params)`, call one service method,
   map the result with the mapper, send it. Nothing else.
3. Service: the use case. Receives plain validated values, returns plain objects, throws
   `AppError`. Depends on repository _interfaces_ passed in by the module's `index.ts`.
4. Repository: the only place that touches Mongoose. Returns plain objects (`.lean()` or an
   explicit mapping), never Mongoose documents.

Express 5 forwards a rejected promise from an `async` handler to the error middleware, so do not
wrap handlers in `try/catch` just to call `next(error)`. Catch only to recover or add context.

## Contract first

- Every input and output has a Zod schema in `<name>.schemas.ts`, imported from
  `shared/http/zod.js` and named with `.openapi('Name')`.
- Register each route in `<name>.openapi.ts`, then add the module in `src/openapi/document.ts`.
- After any schema or route change run `npm run contract` and commit the generated files.
- Mount feature routers under `/api/v1` in `src/app.ts`. A breaking change needs a new version.

## HTTP semantics

- `GET` never changes state. `POST` creates: answer `201` with a `Location` header.
  `PATCH` is a partial update; `PUT` a full replacement; `DELETE` answers `204`.
- Status codes: `400` invalid input, `404` missing (also when the resource must stay hidden),
  `409` conflict (duplicate key, stale version), `429` rate limited. Never `200` with an error body.
- Lists are always paginated: default size 20, maximum 100, validated in the schema. Sort fields
  and directions come from an allowlist, never straight from the query string.
- Editing shared data: accept `If-Match` or a `version` field and answer `409` when it is stale.
- Dates are RFC 3339 strings in UTC. Money is an integer number of minor units plus a currency,
  never a float.

## Errors, logging, configuration

- Throw `new AppError(code, safeDetail)`. `safeDetail` is shown to the client: no ids of other
  users' data, no driver text, no stack.
- Log through the injected `logger`, never `console`. Log an error once, at the boundary that
  handles it. Never log bodies, tokens or personal data.
- Read settings from the `Config` object. `process.env` exists only in `src/config/`.
- External calls need a timeout and a decision about retries. Never retry a non-idempotent call.

## TypeScript in this app

- ESM with `NodeNext`: relative imports end in `.js` even though the file is `.ts`.
- `import type` for type-only imports (`verbatimModuleSyntax` is on).
- `exactOptionalPropertyTypes` is on: an optional property is absent, not `undefined`.
