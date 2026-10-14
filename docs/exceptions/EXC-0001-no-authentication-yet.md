# EXC-0001: No authentication until the ten use cases are complete

- **Status:** accepted
- **Date:** 2026-10-13
- **Requested by:** Agustín Gutiérrez
- **Accepted by:** Agustín Gutiérrez, by approving the environment plan on 2026-10-13, where he
  chose to "focus on the defined use cases first" and add other things after those are
  completed and tested. Review this text and edit it if it does not match what you intended.
- **Rule:** §2.1 "Authenticate and authorize on the server" and §8.1 "Enforce authorization on
  the server for every protected operation".
- **Scope:** the whole API (`apps/api`), the assistant (`apps/assistant`) and the local MongoDB
  container, in **local development only**.
- **Expires:** when use cases CU01–CU10 are merged and tested, or immediately if the system is
  ever to be reachable from another machine, whichever comes first.

## Why the rule cannot be followed here

The proposal defines a single actor and ten use cases, none of which is login. Building
authentication first would delay the part of the project that is being evaluated, and building it
badly in a hurry would be worse than deferring it deliberately.

## Risk

With no authentication, anything that can reach the API can read and change all data. On a
developer machine that means any program running on it, and any web page open in a browser on it
that guesses the port, limited only by the CORS allowlist for cross-origin reads. If a service
were bound to a network address, it would also mean anyone on the same network. MongoDB itself
runs without access control, with the same exposure.

## Compensating controls

| Control                                                | Where                                    | Proof                                                             |
| ------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------- |
| The API refuses to start on a non-loopback host        | `apps/api/src/config/env.ts`             | `env.spec.ts`: "refuses to listen on a network address…"          |
| The assistant refuses to start on a non-loopback host  | `apps/assistant/src/assistant/config.py` | `test_config.py`: "refuses a network address…"                    |
| Every published container port binds `127.0.0.1`       | `docker-compose.yml`                     | review; `docker compose ps` shows `127.0.0.1:`                    |
| CORS allows only the configured web origin             | `apps/api/src/app.ts`                    | `app.spec.ts`: "does not allow an origin that is not on the list" |
| Rate limit and body size limit                         | `apps/api/src/app.ts`                    | `app.spec.ts`                                                     |
| Agents are told not to expose services or fake a login | `.claude/rules/security.md`, `AGENTS.md` | –                                                                 |

The `CONTAINERIZED=true` switch lets the service bind `0.0.0.0` **inside** a container only,
because there the host publishes the port on loopback. It must not be set anywhere else.

## How to remove it

1. Run the `threat-model` skill for authentication and record the decision in an ADR: session
   mechanism, credential storage, password hashing, CSRF, expiry and revocation.
2. Add users and ownership: an owner reference on every resource, and owner filters in every
   repository query, with tests for "another user's resource answers 404".
3. Add authorization tests to every module: no credentials, and valid credentials without
   permission (§10.2).
4. Enable MongoDB access control with a least-privilege application user.
5. Remove the loopback restriction from the two config modules, delete this record's
   compensating-control tests that no longer apply, and set this record to `Status: closed`.

Because ownership touches every collection, do step 2 as an expand → migrate → contract
migration (§4.6).
