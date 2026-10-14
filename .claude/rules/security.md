# Security rules

Standard §8. These apply to every file, so this rule has no path filter.

## Current posture: read this first

`docs/exceptions/EXC-0001` is in force: **there is no authentication**. The compensating control
is that the API, the assistant and MongoDB listen on `127.0.0.1` only. Therefore:

- Never change `HOST`, `ASSISTANT_HOST` or a Compose port mapping to expose a service.
- Never deploy this anywhere reachable from a network until the exception is closed.
- Do not write code that pretends a user is logged in, and do not add a half-built login.
  Authentication is its own roadmap item and starts with the `threat-model` skill.

## Always

- **Untrusted input** is anything from outside the process: HTTP bodies, queries, parameters and
  headers, environment variables, files, model output, and other services' responses. Parse it
  with a schema before use; reject unknown shapes.
- **Injection:** build MongoDB filters from validated named fields. No `$where`, no operator
  keys from clients, no user-controlled regular expressions without escaping and a length cap.
- **Mass assignment:** create and update from an explicit list of allowed fields.
- **Output:** responses go through a mapper; errors through the problem handler.
- **Limits:** body size, page size, string lengths, array lengths and request rate all have a
  maximum in the schema or middleware.
- **Secrets:** only in `.env`, which is git-ignored and off-limits to agents. Add new variable
  _names_ to `.env.example` and to the config schema. If a secret is ever committed, say so
  immediately: it must be rotated, not just deleted.
- **Logs:** no credentials, tokens, cookies, request bodies or personal data.
- **Dependencies:** a new one needs a reason, an active maintainer and a compatible licence.
  Install with exact versions. Never `--force` or `--legacy-peer-deps`. `npm audit` must be
  clean at `high`.
- **Outbound requests** go only to configured base URLs. Never fetch a URL supplied by a client.

## Files (part models, CU02)

Uploaded files are hostile until proven otherwise: enforce a size limit and an extension
allowlist, check the content type, generate the stored name yourself, store outside any served
directory, and never execute or parse them with a tool that runs embedded code.

## When a feature touches roles, files, money, integrations or administration

Run the `threat-model` skill before designing it, and record the result in the ADR.
