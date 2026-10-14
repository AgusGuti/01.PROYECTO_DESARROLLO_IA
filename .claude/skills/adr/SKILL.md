---
name: adr
description: Records an architecture decision as a short document in docs/adr. Use when a significant or hard-to-reverse choice is made (a data model, a library or dependency, an API convention, an algorithm for the optimiser, a security mechanism), or when the user asks why something was decided.
---

# Architecture decision record

Standard §15.1: record significant decisions and the alternatives. An ADR answers the question a
future reader will have: "why is it like this, and what else was considered?"

## When

Write one when the decision is expensive to reverse or will be copied: a collection's shape, a
new dependency, a convention every module follows, the scheduling approach, anything about
authentication. Do not write one for a choice the code already makes obvious.

## How

1. Read `docs/adr/` first. If an existing ADR covers the topic, either follow it or write a new
   one that supersedes it; never edit the decision of an accepted ADR.
2. Next number = highest `NNNN` + 1. File: `docs/adr/NNNN-short-kebab-title.md`.
3. Fill the template. Keep it to one page. Be specific about this project.
4. Agustín decides: set `Status: proposed` when the choice is his to make and present the
   options with a recommendation; `accepted` only when he has chosen.

## Template

```markdown
# NNNN. <decision as a short statement>

- **Status:** proposed | accepted | superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

<the problem and the forces at play: requirements, constraints, what we know and do not know>

## Decision

<what we will do, stated plainly>

## Alternatives considered

- **<option>**: <why not>
- **<option>**: <why not>

## Consequences

<what gets easier, what gets harder, what we must remember, when to revisit>
```

## Quality bar

- The alternatives are real ones, each with an honest reason for rejection.
- "Consequences" includes at least one cost of the chosen option.
- If the decision adds a pattern, platform or dependency, the context names the measured or
  specified need that justifies it (standard §1.2, §2.2). If there is none, the right ADR is
  "we will not do this yet".
