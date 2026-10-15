# 0021. Cost settings are one versioned document, with defaults at version 0

- **Status:** accepted
- **Date:** 2026-10-16

## Context

The electricity price, the wear per hour, the fixed cost per job and the default margin are
global, editable numbers. Agustín chose a settings screen. There must be no invented tariffs.

## Decision

- One document in the `settings` collection with the fixed string `_id: 'costs'`. Fields:
  `kwhPriceMinor`, `wearPerHourMinor`, `fixedPerJobMinor` (integers 0..1,000,000,000, centavos),
  `defaultMarginBasisPoints` (integer 0..100,000), `version`, `createdAt`, `updatedAt`. It is flat
  (ADR 0012), never deleted, with no `deletedAt`, and has no index beyond `_id`.
- `GET /api/v1/costs/settings` returns the document or the **defaults** (all zeros, `version: 0`,
  `updatedAt: null`). A `GET` never writes.
- `PUT /api/v1/costs/settings` (strict, all fields required, `version` integer >= 0): version 0
  means "never saved" and does `insertOne` with the fixed `_id`; a duplicate key means someone
  saved first, so 409 on `version`. Version >= 1 does `findOneAndUpdate({ _id, version })` with
  `$set` and `$inc`; a null result is a stale version, 409. It answers 200 with the new settings.
  `PUT` and not `PATCH`, because the form always saves the four numbers together.
- The unique `_id` is the singleton guarantee, even for two simultaneous first saves.
- The default margin is the value the estimate form pre-fills when "¿Venta?" is ticked (ADR 0020).

## Alternatives considered

- **Create the document lazily on `GET`:** a `GET` that writes, racing between two readers.
- **One `upsert` with filter `{ _id, version }`:** conflates a conflict with a duplicate key and is
  hard to read.
- **Environment variables:** the values must be editable in the app.
- **One collection or document per setting:** no need.

## Consequences

- The first save sends `version: 0`. Other future settings would get another `_id` in the same
  collection.
- With everything at zero every estimate looks cheap; the `settings_not_configured` warning makes
  that visible.
- Once authentication exists the settings will need an owner (not designed now).
