# 0001. Layered modular monolith in one repository

- **Status:** accepted
- **Date:** 2026-10-13

## Context

One developer, new to Express, Angular and Node, is building a system with three functional
areas (management, costs, scheduling) and a chat assistant. The engineering standard §1 selects a
layered modular monolith. The pieces must be easy to run, test and change together.

## Decision

- One git repository using **npm workspaces**: `apps/api` (Express), `apps/web` (Angular),
  `packages/api-contracts` (generated contract). `apps/assistant` (Python) lives in the same
  repository but is managed by `uv`, not npm.
- The API is **one deployable process**, organised by business module under
  `src/modules/<name>/`, and by layer inside each module: routes → controller → service → domain,
  with a repository for persistence. A module is used only through its `index.ts`.
- Dependencies are wired by plain factory functions (`createHealthModule({ database, clock })`).
  No dependency-injection container.
- The boundaries are enforced by `dependency-cruiser` (`npm run arch`) and ESLint, not by
  convention alone.

## Alternatives considered

- **Separate repositories per app:** every contract change would need coordinated commits and
  versioned packages. Too much ceremony for one person.
- **Microservices:** no scaling, team or isolation requirement justifies the operational cost
  (§1.2, §2.2). The Python assistant is separate only because it is a different language.
- **Folders by technical type** (`controllers/`, `services/`, `models/`): understanding one
  feature means visiting every folder (§1.2).
- **Nx or Turborepo:** useful for large workspaces; here plain npm scripts are enough and one
  less tool to learn.
- **A DI container (Inversify, tsyringe):** hides wiring behind decorators (§3). Functions and
  parameters are explicit and need no library.

## Consequences

- Adding a feature means adding a module folder with a known file set (`new-api-module` skill).
- A module cannot quietly reach into another; sharing requires an explicit export.
- Wiring is manual in each `index.ts` and in `app.ts`. That is a few lines per module and stays
  readable; revisit only if it becomes a real burden.
- Everything is versioned and released together, which is what we want now.
