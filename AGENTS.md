# Print3D Planner: instructions for AI agents

A web system to manage FDM 3D-printing projects, calculate their costs and optimise the print
queue. Stack: MongoDB, Express, Angular, Node.js (MEAN), plus a Python chat assistant built with
LangChain. One developer, Agustín, who knows MongoDB and is new to Express, Angular and Node.

These rules bind every agent and every model. They summarise
[the engineering standard](docs/standards/mean-engineering-standard.md), which is the authority:
when in doubt, read the section cited as `§n`.

## Your job

Agustín asked for an environment that keeps him on good practices **even when he asks to deviate**.
He is new to this stack, so a request to cut a corner is usually a beginner's mistake, not an
informed trade-off. Treat it that way.

### Pushback protocol

When a request, or your own shortcut, would break a MUST from the standard:

1. **Name the rule** and its section.
2. **Explain the concrete consequence** in plain language, for someone who has not met it before.
3. **Offer the compliant way** to reach the same goal, with an honest estimate of the extra work.
4. **Do not comply silently, and never weaken a gate** (lint rule, type check, test, hook, CI
   step) to make something pass.
5. If he still wants to deviate, the only path is the `request-exception` skill, which drafts
   `docs/exceptions/EXC-NNNN-*.md` for **him** to accept. You never accept an exception yourself.

A blocked edit or command is information, not an obstacle. Do not look for another route to the
same result (a different tool, a shell redirect, an equivalent pattern).

### Teach as you go

The first time a concept appears in a session (middleware, dependency injection, signals,
observables, an index, a transaction...), add two or three plain sentences: what it is and why it
is done this way here. Skip it for concepts already explained. Reply in the language he writes in.

### Honesty about verification

Never say a test, build or check passed unless you ran it and read the result (§0.1). If something
was not run, say so. A skipped gate is not a passed gate.

## Layout

```text
apps/api/        Express 5 + TypeScript. Layered modular monolith.
apps/web/        Angular 22, standalone components, signals. UI text in Spanish.
apps/assistant/  Python 3.12, FastAPI + LangChain. Reaches data only through the API.
packages/api-contracts/   GENERATED OpenAPI document and TypeScript types. Never edit.
docs/            standards/, product/ (proposal, roadmap), adr/, exceptions/, runbooks/, ai/
scripts/         bootstrap, doctor, verify, contract; ai/ holds the guards
```

API modules live in `apps/api/src/modules/<name>/`, one folder per business feature:

| File                         | Responsibility                                              | Must not                                             |
| ---------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `<name>.routes.ts`           | URL to controller method                                    | contain logic                                        |
| `<name>.controller.ts`       | parse input, call the service, map the result to HTTP       | hold business rules, import a repository or Mongoose |
| `<name>.schemas.ts`          | Zod schemas for input and output (the contract's source)    | be bypassed                                          |
| `<name>.service.ts`          | the use case: coordinates rules, repositories, transactions | import Express or Mongoose                           |
| `<name>.domain.ts`           | business rules and invariants, pure functions               | import any framework                                 |
| `<name>.repository.ts`       | all MongoDB access; returns plain objects                   | return Mongoose documents to callers                 |
| `<name>.mapper.ts`           | internal model to response DTO                              | leak internal fields                                 |
| `<name>.openapi.ts`          | registers the routes in the contract                        |                                                      |
| `index.ts`                   | the module's only public surface                            |                                                      |
| `*.spec.ts`, `*.int.spec.ts` | unit tests; integration tests against real MongoDB          |                                                      |

Dependencies point one way: HTTP → service → domain. Another module is used only through its
`index.ts`. `health` is the reference module: copy its shape.

## Commands

Run everything from the repository root.

| Command                                                               | Purpose                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run bootstrap`                                                   | install everything project-locally; start MongoDB                 |
| `npm run doctor`                                                      | check the machine and services; prints the fix for each problem   |
| `npm run dev`                                                         | API (3000) + web (4200) + assistant (8000)                        |
| `npm run db:up`                                                       | MongoDB in Docker (single-node replica set)                       |
| `npm run verify:quick`                                                | fast gates; must pass before you stop                             |
| `npm run verify`                                                      | every gate; must pass before a pull request                       |
| `npm run contract`                                                    | regenerate the OpenAPI document and types after changing a schema |
| `npm run test:api` / `test:int` / `test:web` / `py:test` / `test:e2e` | individual test suites                                            |
| `npm run py -- <tool> ...`                                            | run a Python tool from the assistant's `.venv`                    |
| `npm run ai:sync`                                                     | regenerate `.opencode/agents/` after editing `.claude/agents/`    |

The project is self-contained: nothing is installed globally. Tools live in `node_modules`,
`apps/assistant/.venv`, `.tools/` or Docker.

## Workflow for every change (§18)

1. **Understand.** Read the affected code, its tests and the relevant use case in
   `docs/product/`. Reuse the existing pattern; do not add a second way to do the same thing.
2. **Plan.** State affected modules and layers, invariants, risks and the tests you will write.
   If a requirement is missing, ask one focused question. Never invent business requirements.
3. **Implement** the smallest change that meets the requirement.
4. **Test.** For each use case: success, invalid input and boundaries, missing resource,
   conflicts, and failure of a dependency (§10.2).
5. **Verify.** `npm run verify:quick`, then `npm run verify` before a pull request.
6. **Document.** Regenerate the contract; add an ADR for a significant decision.
7. **Report** what changed, what you ran and its result, assumptions, and what remains open.

Work on a branch (`feat/…`, `fix/…`, `chore/…`), commit with Conventional Commits, and merge
through a pull request with green CI. Never commit on `main`.

## Non-negotiables

Each of these is enforced by a guard, a lint rule or a test. This list is so you get it right the
first time.

- **Types:** no `any`, no `as unknown as`, no `@ts-ignore`. External data is `unknown` until a
  Zod schema (Pydantic in Python) has parsed it. Types are not validation (§5).
- **Validation:** every request body, query and path parameter is parsed by a schema before use.
  Never pass `req.body` to a model or query. Allowlist sortable and filterable fields (§8.2).
- **Errors:** throw `AppError`; the central handler answers with RFC 9457 problem details.
  Never return stack traces, driver messages or internal fields (§6.3).
- **Config and secrets:** environment variables are read only in `apps/api/src/config/` and
  `apps/assistant/src/assistant/config.py`. Agents never read or write `.env`. No secrets in
  code, logs or the frontend bundle (§6.5).
- **Data:** uniqueness needs a unique index, not a prior lookup. Prefer one atomic conditional
  update to read-modify-write. Use a transaction only when an invariant spans documents.
  Paginate every list with a maximum size (§4).
- **Angular:** the client is never a security boundary. No sanitizer bypass, no raw DOM HTML.
  Every data view handles loading, empty, error and success. Accessible by keyboard (§9).
- **Tests:** never skip, focus or delete a failing test to get green. A fixed bug gets a
  regression test (§10.3).
- **Dependencies and patterns:** a new dependency, service or pattern needs a demonstrated need.
  No microservices, CQRS, event sourcing, NgRx, cache or queue without an ADR (§1.2, §2.2).
- **Scope:** no unrelated refactors inside a functional change (§17).

When rules conflict, prioritise (§20): security and privacy → correctness and data integrity →
public contracts → availability → maintainability → measured performance → style.

## Exceptions currently in force

See `docs/exceptions/`. At the time of writing: **EXC-0001**, no authentication yet, so the API
and the assistant listen on the loopback interface only and must never be exposed to a network.
Do not add anything that assumes a logged-in user until the roadmap reaches authentication.

## More

- Roadmap and current item: `docs/product/roadmap.md`
- Decisions already taken: `docs/adr/`
- How this AI environment works: `docs/ai/README.md`
- Topic rules: `.claude/rules/` (API, web, data, testing, security, assistant)
