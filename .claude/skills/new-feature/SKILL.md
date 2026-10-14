---
name: new-feature
description: Drives a use case or feature from requirement to pull request following the engineering standard. Use whenever the user asks to build, add or implement a use case (CU01-CU10), a feature, an endpoint together with its screen, or any change spanning more than one layer.
---

# New feature

The workflow from standard §18. Do the steps in order. Each ends with something Agustín can read
and correct before the next one starts, which is cheaper than correcting code.

## 1. Understand

- Read the use case in `docs/product/propuesta-proyecto-impresion-3d.md` and
  `docs/product/roadmap.md`. If the feature is not the current roadmap item, say so and ask
  whether to switch; earlier items may be prerequisites.
- Read the modules it touches, `docs/adr/` and `docs/exceptions/`.
- Confirm you are on a feature branch. If on `main`: `git switch -c feat/<short-name>`.

## 2. Acceptance criteria

Write the criteria as testable statements ("Creating a filament with a negative weight answers
400 and names the field"). List the business rules you had to **assume** separately and ask
Agustín to confirm them. Do not continue on an unconfirmed rule that is hard to reverse (a data
model choice, a formula, a state machine).

## 3. Design

Use the `architect` agent. Expect: flow, affected files, contract, data model with invariants and
indexes, decisions, risks. For a new collection also use the `mongo-model` skill. For anything
touching files, money, roles or integrations, use the `threat-model` skill. Record significant
decisions with the `adr` skill.

## 4. Test plan

Use the `qa` agent in planning mode to turn the criteria into a requirement-to-test matrix.

## 5. Build, back to front

1. **API**: `new-api-module` skill, or the `backend-api` and `data-mongodb` agents.
   Then `npm run contract`.
2. **Web**: `new-web-feature` skill, or the `angular-frontend` agent. Only after the contract
   contains the endpoints.
3. Keep each commit small and passing. Conventional Commits.

Explain each new concept briefly the first time it appears.

## 6. Verify

Use the `verify` skill: `npm run verify`, and `npm run test:e2e` if a critical flow changed.
Then the `code-reviewer` agent, and `qa` in audit mode. Fix blockers; re-run.

## 7. Hand over

Report: what was built, the criteria and which test proves each, the real gate summary,
assumptions, and what is left. Offer to open the pull request (`.tools/gh/bin/gh pr create`);
pushing and merging need Agustín's go-ahead. Update the **Current** line in the roadmap when the
item is merged.

## If asked to skip a step

Apply the pushback protocol from `AGENTS.md`. Skipping the design or the tests on a use case is
exactly the mistake this workflow exists to prevent.
