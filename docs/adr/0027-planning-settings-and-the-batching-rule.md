# 0027. Planning settings are one versioned document, and identical pieces may share a plate

- **Status:** accepted
- **Date:** 2026-10-16

## Context

CU08 (M3.4) may print identical pieces together on one plate (decision of 2026-10-15: never
different pieces on the same plate). Two things were open: how many pieces fit on a plate, and
whether a shared plate is faster than separate prints. Agustín decided the capacity rule below and
asked for the time saving to be a setting, with no invented value.

## Decision

- **Planning settings** copy ADR 0021 exactly: one document in the `planningSettings` collection
  with the fixed `_id: 'planning'`; field `batchSavingBasisPoints` (integer 0..5000), `version`,
  `createdAt`, `updatedAt`; flat, never deleted, no index beyond `_id`.
  `GET /api/v1/planning/settings` answers the document or the default (`0`, `version: 0`,
  `updatedAt: null`) and never writes. `PUT` (strict, both fields required) with `version: 0` is
  `insertOne` (a duplicate key is a 409 on `version`, so two simultaneous first saves have one
  winner); with `version >= 1` it is `findOneAndUpdate({ _id, version })` with `$set` and `$inc`
  (null result: 409). A small module `planning` owns it; the simulations read it through a
  `PlanningReader` port built in `app.ts` (ADR 0017). The default of 0 means: sharing a plate
  saves no time until Agustín sets a value.
- **Capacity of a plate** for N identical pieces of a part on a printer is valid when
  `N * (partX + 10) * (partY + 10) <= 0.9 * bedX * bedY` (compared as integers,
  `10 * N * cellX * cellY <= 9 * bedX * bedY`), N cells of `(partX + 10) x (partY + 10)` fit the
  bed as a grid (`floor(bedX / cellX) * floor(bedY / cellY)`, in the better of the two
  orientations; 40 x 40 on 220 x 220 gives 16, not the 17 of the area alone; 110 x 110 gives 1),
  and `partX + 10 <= bedX`, `partY + 10 <= bedY` and
  `partZ <= build height`. The capacity is the largest valid N, at most 20 and at least 1: a
  piece that does not fit even alone is still planned alone, exactly as the naive planner does,
  because this ADR is not a printability check. The 10 mm is free space around each piece.
  The grid bound guarantees that a plate offered can physically exist; no real packing is
  attempted, so this is still an estimate, not a layout.
- **Plate duration** for `n` pieces is `ceil(n * seconds * (10000 - saving) / 10000 / 60)` minutes
  in exact integer arithmetic (at most 20 pieces and a bounded print time keep every product far
  below 2^53). One piece is the single print time (`ceil(seconds / 60)`, at least a minute) and
  never gets the saving; the saving models what is shared by a whole plate (heating, first layers,
  travel).
- **Plates of a line**: the remaining units of a line form full plates of the capacity of the
  printer that receives each plate, plus one smaller remainder plate. Printers with different beds
  can therefore take different plate sizes of the same line.
- The module stores the setting; the rule lives in the pure optimiser (ADR 0028).

## Alternatives considered

- **A time saving hard-coded in code:** an invented number; the user cannot adjust it.
- **Saving per part or per printer:** more fields and screens than the evidence supports.
- **Real 2D packing, rotation:** a different problem (and a slicer's job); the area rule is
  explainable and cautious (90 %).
- **Reuse the `settings` collection:** possible (ADR 0021 mentions it), but a separate collection
  keeps each module's data apart, as the instructions for this item asked.

## Consequences

- With the default 0 batching reduces the number of collections but not the printing time, so the
  optimiser only prefers it when the goal benefits (for example the 14-hour night wait).
- The size of a part (`dimensionsMm`) and the build volume of a printer are read through the
  simulation ports; if a part has no real size, the estimate is only as good as the data entered.
- A part larger than the bed is not rejected here; that check would belong to the queue.
- Once authentication exists the settings will need an owner (not designed now).
