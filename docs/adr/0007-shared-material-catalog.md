# 0007. Materials are a closed list shared by printers and filaments

- **Status:** accepted
- **Date:** 2026-10-14

## Context

A printer lists the materials it can print (CU06) and a filament has a material (CU05). The
planner will later match one against the other, so both sides must use exactly the same values.
Agustín chose a closed list covering the typical FDM materials. Some materials, those reinforced
with carbon or glass fibre, wear a brass nozzle, which CU06 turns into a domain rule.

## Decision

The list lives in `apps/api/src/shared/catalog/`, which holds only constants, enums and pure
helpers:

- `materials.ts`: `MATERIALS` (`PLA, PETG, ABS, ASA, TPU, PA, PC, HIPS, PVA, PP, PLA_CF,
PETG_CF, PA_CF, PA_GF`), the `Material` type, and `isReinforcedMaterial(m)`, true when the
  value ends in `_CF` or `_GF`.
- `materials.schemas.ts`: `materialSchema = z.enum(MATERIALS).openapi('Material')`, so the
  OpenAPI document has one named `Material` component that CU05 reuses.

Commercial variants (PLA+, silk, wood or metal filled) count as `PLA`: for compatibility they
behave the same. The web has no endpoint for the list; it keeps `Record<Material, string>`
labels in Spanish typed from the generated contract, so the compiler fails when the API adds a
value the labels lack.

## Alternatives considered

- **A `materials` collection with its own CRUD:** the list is closed and changes only with code.
  A collection adds a table, a screen and a runtime lookup for no benefit.
- **Each module keeps its own copy:** the copies drift, and the matching in the planner breaks
  silently.
- **Filaments import the printers module:** makes one module depend on another's internals,
  against the module rules.

## Consequences

- Adding a material is a code change in one file plus a regenerated contract and one label in
  the web; the compiler lists what is missing.
- The list is not user-editable. If users ever need their own materials, this ADR is superseded.
- The web label list is one more place to edit; typing it as a `Record` limits the risk.
- The suffix convention (`_CF`, `_GF`) is part of the contract between the catalog and the
  printer rule; a new reinforced material must follow it or the rule will not see it.
