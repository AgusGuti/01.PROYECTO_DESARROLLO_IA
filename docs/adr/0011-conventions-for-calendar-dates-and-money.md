# 0011. Conventions for calendar dates and money

- **Status:** accepted
- **Date:** 2026-10-14

## Context

CU05 stores a purchase date and an acquisition cost. Later use cases (costs CU03 and CU04,
planning) will sum money and group by date, so the representation is expensive to change. Agustín
decided the cost is in Argentine pesos only, and the data rules already require integer minor
units and integer grams.

## Decision

- **Calendar date** (a day without a time, such as `purchaseDate`): stored as a UTC `Date` at
  midnight. The API exposes it as an RFC 3339 `full-date` string, `YYYY-MM-DD`. "Today" for a
  business rule is the UTC date of the injected clock, and the form limits the input to that day
  so a user in Argentina (UTC-3) is never rejected for choosing today.
- **Money:** a non-negative integer of minor units in a field named `<thing>Minor` (here
  `purchaseCostMinor`, centavos of ARS). There is no currency field while the system is ARS only.
  The OpenAPI description states the unit. The upper bound is 1,000,000,000 centavos
  (ARS 10,000,000), an arbitrary but safe cap that keeps every sum exact.
- **Weights:** integer grams.
- **In the browser:** money is shown with `Intl.NumberFormat('es-AR', { style: 'currency',
currency: 'ARS' })` on `minor / 100`, for display only. Input is parsed with string and integer
  arithmetic, never `parseFloat * 100`. A date is shown by splitting the string, never with
  `new Date('2026-10-01')`, which shows the previous day in UTC-3.

## Alternatives considered

- **A `YYYY-MM-DD` string in the database:** it sorts correctly but mixes types and blocks date
  operators for monthly reports.
- **A full ISO instant in the response:** `...T00:00:00.000Z` is displayed as the previous day in
  UTC-3, a classic bug.
- **A float or decimal for money:** forbidden by the data rules; rounding errors accumulate.
- **A currency field now:** a field with one possible value and no use.

## Consequences

- Adding another currency means a migration (expand, migrate, contract) and a decision about
  exchange rates.
- Cost per gram in CU03 (`purchaseCostMinor / initialGrams`) needs a rounding rule, to be
  confirmed with Agustín at M2.1. It is not decided here.
- Any new money or date field follows this ADR instead of choosing again.
