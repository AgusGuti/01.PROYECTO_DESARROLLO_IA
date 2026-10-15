# 0022. A printer stores its average power in watts

- **Status:** accepted
- **Date:** 2026-10-16

## Context

The electricity cost of a print needs the power the printer draws. Agustín decided to store it on
the printer, with the price per kWh in the settings (ADR 0021).

## Decision

- `powerWatts` is an optional integer 1..5000 on a printer, meaning the **average power while
  printing**, not the power supply rating or the peak. It is `null` when unset and always present
  in the response.
- Create takes it optionally; `PATCH` takes a value or `null` to clear it (same handling as
  `typicalSpeedMmS`); restoring a deleted printer (ADR 0009) applies the submitted value or clears
  it.
- No migration: documents without the field read as `null`.
- The development seed only creates printers that do not exist yet, so a database that already
  holds them keeps `powerWatts: null`; edit those printers in the app to set it.
- The development seed gives the five sample printers plausible average values, flagged as
  estimates to be replaced with a wattmeter reading: Ender-3 V2 Neo 150, Prusa MK4S 120, Bambu
  Lab X1 Carbon 150, Bambu Lab A1 mini 80, Elegoo Neptune 4 Pro 150.

## Alternatives considered

- **A per-material power catalogue:** complexity without a requirement.
- **One global wattage in the settings:** wrong for a mixed fleet (a closed, heated chamber draws
  much more than an open frame).
- **Required on create:** breaks every existing printer.

## Consequences

- The printers contract, form, list and seed change together; the web type guard must accept the
  new field or it rejects every response that has it.
- An estimate without a printer or without its power omits electricity and says so.
