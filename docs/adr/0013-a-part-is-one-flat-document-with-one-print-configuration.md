# 0013. A part is one flat document with one print configuration

- **Status:** accepted
- **Date:** 2026-10-15

## Context

CU02 stores name, description, associated model, dimensions, estimated weight, estimated print
time, material and print configuration. A part is reused across projects (CU01) and its numbers
feed the cost calculation (CU03). Agustín decided: one print configuration per part, names do not
have to be unique, removal is logical.

## Decision

- A part is one flat document in `parts`. `dimensionsMm` and `source` are embedded (small,
  bounded, always read together); nothing is referenced. CU01 will reference parts by id and store
  the quantity, and CU01 and CU03 will snapshot the values they use (data rules).
- Fields and limits (integers only, ADR 0011):

  | Field                   | Rule                                                           |
  | ----------------------- | -------------------------------------------------------------- |
  | `name`                  | text 1..100 code points, no control characters, trim, NFC      |
  | `description`           | optional single line, 1..1000 code points; `null` clears it    |
  | `material`              | `Material` from the shared catalog (ADR 0007)                  |
  | `dimensionsMm`          | `{x, y, z}` integers 1..1000; replaced whole on `PATCH`        |
  | `estimatedWeightGrams`  | integer 1..20000                                               |
  | `estimatedPrintSeconds` | integer 1..2,592,000 (30 days)                                 |
  | `layerHeightUm`         | integer 10..2000 (micrometres: 0.01 to 2 mm)                   |
  | `suggestedPrinterName`  | optional free text 1..100; `null` clears it                    |
  | `source`                | `{kind:'manual'}` or `{kind:'gcode', fileName, slicer:'cura'}` |

- **`source` and its trust model.** The client sends `kind`, `fileName` (1..255 code points) and
  `slicer`; the **server adds `analyzedAt`** from the injected clock, and a client that sends it
  gets 400. `analyzedAt` therefore means "when the part was saved with that source", because the
  analysis itself stores nothing. The client could falsely claim `gcode`; that is accepted because
  `source` is metadata only and no calculation reads it. A `PATCH` re-stamps `analyzedAt` only
  when it carries a `source`.
- **No model file is stored.** "Associated file or model" is satisfied in phase 1 by `source`
  metadata. A stored model file (`.3mf`) is phase 2 and needs its own threat model and ADR.
- **`suggestedPrinterName` is free text, not a reference** to `printers`: Cura's machine name is the
  slicer's definition name, not the name typed in the printers collection, and printers have their
  own lifecycle (ADR 0006 and 0009). CU07 will choose the printer by id.
- Operations as in filaments: `POST` (201 + `Location`), `GET` list (page, `pageSize` up to 100,
  filter `material`, sort `name | createdAt | estimatedWeightGrams | estimatedPrintSeconds`, default
  `name` ascending, `_id` tiebreak, name sort with collation `es` strength 2), `GET /:id`, `PATCH`
  with required `version` (precedence 400, 404, stale 409 with path `version`, atomic write),
  logical `DELETE` (204, repeated is 404). No free-text search: filter plus sort is enough for
  hundreds of parts.
- No uniqueness on `name`, no reservation, no restore. No secondary index and no change to the
  startup index assertion (same reasoning as ADR 0012).

## Alternatives considered

- **A closed set of layer heights:** Cura accepts any value, so an import would be rejected.
- **Decimal millimetres:** float traps; integers are the data rule.
- **A signed token for `analyzedAt`:** a secret and cryptography for a metadata field.
- **Several configurations per part:** not requested, and CU03 does not need it yet.
- **Unique names:** brings the whole printers apparatus (ADR 0009) for a convenience.

## Consequences

- CU01 needs a "part in use" check before allowing removal, like `PrinterUsageCheck`.
- Layer height is an integer, so the web converts it with string arithmetic, never floats.
- Weight and time are estimates; the UI says so.
- Deleted parts accumulate; revisit with a retention policy if that ever matters.
- `DELETE` carries no `version`, so a user can remove a part that someone else just edited. It is
  atomic on `deletedAt` and acceptable for one user (EXC-0001); revisit when users exist.
