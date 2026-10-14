# 0005. Toolchain and self-containment

- **Status:** accepted
- **Date:** 2026-10-13

## Context

The developer requires the project to be self-contained in its folder: virtual environments,
Docker and project-local tools rather than global installs. The stack is fixed (MongoDB, Express,
Angular, Node, plus Python for the assistant); the libraries around it had to be chosen, and the
standard asks for maintained, standard mechanisms over home-grown ones (§0.3).

## Decision

**Host prerequisites (the only things installed on the machine):** Node.js 22 LTS (≥ 22.22.3,
required by Angular 22), Python 3.12, Docker Desktop, Git. `npm run doctor` checks them.

**Everything else lives in the project or in Docker:**

| Need               | Choice                                                     | Where it lives                          |
| ------------------ | ---------------------------------------------------------- | --------------------------------------- |
| Node packages      | npm workspaces, exact versions, `npm ci`                   | `node_modules/`                         |
| Install scripts    | npm `allowScripts` allow-list, pinned by version           | `package.json`                          |
| Python packages    | `uv` with a lockfile                                       | `apps/assistant/.venv/` (uv itself too) |
| MongoDB            | `mongo:8.2`, single-node replica set                       | Docker volume `print3d_mongo-data`      |
| MongoDB for tests  | `mongodb-memory-server` replica set                        | binary in `node_modules/.cache/`        |
| Ollama             | the installed desktop app, or the `ollama` Compose profile | host, or Docker volume                  |
| `gitleaks`, `gh`   | pinned version + SHA-256, downloaded by bootstrap          | `.tools/` (git-ignored)                 |
| Playwright browser | `PLAYWRIGHT_BROWSERS_PATH=0`                               | `node_modules/`                         |

**Libraries:**

| Area                | Choice                                                                          | Why                                                                       |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| HTTP                | Express 5                                                                       | the stack; v5 forwards async errors to the error handler                  |
| ODM                 | Mongoose 9                                                                      | the standard assumes it; schemas, validation and typing over the driver   |
| Validation          | Zod 4                                                                           | runtime validation with inferred types; source of the contract (ADR-0002) |
| Logging             | Pino                                                                            | structured JSON, fast, redaction built in                                 |
| Security middleware | Helmet, cors, express-rate-limit                                                | the maintained defaults                                                   |
| API and web tests   | Vitest (+ supertest)                                                            | one runner for both; Angular 22's default                                 |
| End-to-end          | Playwright                                                                      | one smoke test for now                                                    |
| Lint and format     | ESLint 10 + typescript-eslint (strict, type-checked) + angular-eslint; Prettier |                                                                           |
| Architecture        | dependency-cruiser                                                              | executable layer rules                                                    |
| Python quality      | Ruff, mypy `--strict`, pytest                                                   |                                                                           |
| Language            | TypeScript 6.0 everywhere                                                       | the only line Angular 22 and typescript-eslint both support               |

## Alternatives considered

- **A dev container for everything:** fully hermetic, but file watching and Angular rebuilds
  through Windows bind mounts are slow, and the agent hooks run on the host anyway.
- **A project-local Node binary in `.tools/`:** purer, but every editor, hook and terminal would
  need its PATH rewritten. A pinned host Node checked by `doctor` and `engine-strict` is robust.
- **MongoDB Atlas:** nothing to run locally, but needs a network and a secret; local Docker is
  free, offline and disposable.
- **Testcontainers instead of `mongodb-memory-server`:** closer to the Compose image, but
  slower and needs Docker inside CI jobs; the in-memory server runs the real `mongod` binary as a
  replica set, which is enough.
- **Jest:** still common, but slower with ESM and TypeScript and not Angular's default any more.

## Consequences

- A fresh clone needs one command: `npm run bootstrap`.
- Node was upgraded in place from 22.18.0 to 22.23.2 with `winget` on 2026-10-13 because
  Angular 22 refuses older 22.x releases. That was the one change made outside the project
  folder.
- `skipLibCheck` is on: type errors inside third-party declaration files are not ours to fix
  (one library ships a declaration that needs a package it does not depend on).
- Ollama model files and Docker volumes live in Docker's or Ollama's own storage, not literally
  inside the project folder. Bind-mounting MongoDB data into a Windows folder is unsupported by
  MongoDB and was rejected.
- `js-yaml` is forced to the patched 4.3.2 with an npm `overrides` entry, because two tooling
  dependencies still ask for a release with a known advisory. Remove the override when they
  update.
- Major upgrades (Node 24, TypeScript 7, the next Angular) are deliberate tasks for the
  `devops-sre` agent, one at a time, each followed by `npm run verify`.
