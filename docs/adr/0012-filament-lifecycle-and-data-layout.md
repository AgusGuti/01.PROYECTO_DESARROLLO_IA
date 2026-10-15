# 0012. A filament is one flat document with logical removal and no secondary index

- **Status:** accepted
- **Date:** 2026-10-14

## Context

ADR 0006 and 0009 shaped printers around a unique name, a transitional archived state and a
restore flow, because printers are referenced by the print queue. Filaments differ: two spools of
the same brand, material and colour are legitimate, and nothing assigns work to a spool yet.

## Decision

- A filament is a single flat document in `filaments`: no embedded sub-entities and no references.
- It has **no unique key**, so there is no name reservation, no duplicate-key path, no archive and
  no restore.
- `DELETE` is logical (`deletedAt`). A repeated `DELETE` answers 404, because there is no archived
  state to be idempotent about.
- There are **no secondary indexes** beyond `_id`, and the startup index assertion and
  `npm run db:indexes` are unchanged. The list filters on `deletedAt`, optionally on `material`
  and on whether stock remains, and sorts on four fields. At tens to hundreds of documents a
  collection scan costs microseconds, and an index per sort key would slow every consume and edit
  (§4.5). Seeing a collection scan in `explain` is expected and accepted here.
- No `$jsonSchema` validator: the cross-field rule `availableGrams <= initialGrams` cannot be
  expressed without `$expr`, and the repository is the only writer.

## Alternatives considered

- **Physical delete:** later projects and costs (CU01, CU03) need to keep references and history.
- **Archive and restore like printers:** those rules exist because printers carry a unique name
  and are referenced by the queue; neither applies here.
- **Indexes now:** a guess without a measured query. Revisit when CU04 or CU07 need "spools of
  material X with at least N grams" (a compound index on `material` and `availableGrams`) or when
  the collection passes a few thousand documents, using `explain('executionStats')`.

## Consequences

- CU01 and CU03 must **snapshot** the filament values they were computed from, as the data rules
  require. A usage check like `PrinterUsageCheck` is added then if a filament in use must not be
  deleted.
- A double `POST` creates two spools. The web disables Save while a request is in flight; there
  is no server idempotency key because nothing requires one.
- Deleted documents accumulate; revisit with a retention policy if that ever matters.
