# 0015. Estimated grams come from a density table and a fixed 1.75 mm diameter

- **Status:** accepted
- **Date:** 2026-10-15

## Context

Cura's Marlin header gives the filament length, not the weight. To fill a part's estimated weight
from an import, the length has to be converted using the material's density and the filament
diameter. Agustín confirmed the table below.

## Decision

- `FILAMENT_DENSITY_G_CM3` lives in `shared/catalog/materials.ts`, next to `MATERIALS`, as a
  `Record<Material, number>`: adding a material fails to compile until it has a density.
- Values (typical, ±3 % between brands): PLA 1.24, PETG 1.27, ABS 1.04, ASA 1.07, TPU 1.21,
  PA 1.14, PC 1.20, HIPS 1.04, PVA 1.19, PP 0.90, PLA_CF 1.30, PETG_CF 1.30, PA_CF 1.20,
  PA_GF 1.35.
- Formula: `grams = round(lengthMm × π × 0.875² × density / 1000)`. The diameter is the constant
  `FILAMENT_DIAMETER_MM = 1.75` with a `shortcut:` comment (only 1.75 mm filament; make it a
  setting if 2.85 mm is ever used).
- The warning `GRAMS_FROM_DENSITY_TABLE` is always returned when grams are computed.
- A test checks that every material has a density between 0.8 and 1.5.

## Alternatives considered

- **Density stored per filament or per brand:** no requirement yet.
- **An editable density per part:** the weight is already editable.
- **Fractional grams:** integers only (data rules).

## Consequences

- Adding a material means one more constant, enforced by the compiler.
- The estimated weight is an approximation, and the UI says so.
