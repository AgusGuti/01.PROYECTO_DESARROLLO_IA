# Print3D Planner

A web system to manage FDM 3D-printing projects, calculate their costs and optimise the print
queue around the hours when someone can attend the printer.

Course project for _Arquitectura de Agentes y AI-Augmented Software Engineering_ (UNLa), built on
the MEAN stack with a LangChain chat assistant. See
[the proposal](docs/product/propuesta-proyecto-impresion-3d.md) and
[the roadmap](docs/product/roadmap.md).

**Status:** environment and skeleton complete. No business features yet; next is CU06.

## Stack

| Part      | Technology                              | Folder                   |
| --------- | --------------------------------------- | ------------------------ |
| Web       | Angular 22, TypeScript                  | `apps/web`               |
| API       | Node.js 22, Express 5, TypeScript, Zod  | `apps/api`               |
| Database  | MongoDB 8 (Mongoose)                    | Docker                   |
| Assistant | Python 3.12, FastAPI, LangChain, Ollama | `apps/assistant`         |
| Contract  | OpenAPI 3.1, generated                  | `packages/api-contracts` |

## Quick start

Prerequisites on the machine: Node.js 22 (≥ 22.22.3), Python 3.12, Docker Desktop, Git.
Everything else is installed inside this folder or in Docker.

```bash
npm run bootstrap   # install everything locally and start MongoDB
npm run doctor      # check that the machine is ready
npm run dev         # web: http://localhost:4200   API: http://127.0.0.1:3000
```

Open http://localhost:4200: the status page should say "Todo funciona correctamente."

## Everyday commands

| Command                                                               | What it does                                        |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `npm run dev`                                                         | start API, web and assistant with reload on change  |
| `npm run verify:quick`                                                | fast quality gates                                  |
| `npm run verify`                                                      | every quality gate; run before a pull request       |
| `npm run contract`                                                    | regenerate the API contract after changing a schema |
| `npm run test:api` · `test:int` · `test:web` · `py:test` · `test:e2e` | individual test suites                              |
| `npm run db:up` · `db:down` · `db:shell`                              | MongoDB in Docker                                   |

More, including troubleshooting and backups: [the local environment runbook](docs/runbooks/local-environment.md).

## How work is done here

- Every change is made on a branch and merged through a pull request with green CI.
- Code follows [the engineering standard](docs/standards/mean-engineering-standard.md), and the
  repository enforces it: lint, strict types, architecture rules, tests, git hooks and CI.
- AI agents (Claude Code, OpenCode) work under the same rules and are blocked when they break
  them. Start with [how the AI environment works](docs/ai/README.md).
- A rule is lifted only by a written, accepted [exception](docs/exceptions/). One is in force:
  [EXC-0001](docs/exceptions/EXC-0001-no-authentication-yet.md), no authentication yet, so every
  service listens on this machine only. **Do not expose or deploy the system until it is closed.**
- Significant decisions are recorded in [docs/adr](docs/adr/).

## Repository map

```text
apps/api/          Express API: src/modules/<feature>/ holds each feature, layer by layer
apps/web/          Angular app: src/app/features/<feature>/
apps/assistant/    Python chat assistant
packages/          generated API contract (never edited by hand)
docs/              standard, proposal, roadmap, decisions, exceptions, runbooks, AI guide
scripts/           bootstrap, doctor, verify, contract; ai/ holds the guards
e2e/               Playwright end-to-end tests
.claude/ .opencode/  agents, skills, rules, hooks and plugin for the AI tools
```
