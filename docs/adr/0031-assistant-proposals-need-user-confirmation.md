# 0031. Assistant proposals need the user's confirmation

- **Status:** accepted
- **Date:** 2026-10-16

## Context

ADR 0004 says the assistant reads through tools and never writes: a write is a proposal that the
user confirms. M4.3 adds the first proposal. `POST /api/v1/chat` answers `{ reply, proposal }`,
where `proposal` is `null` or a suggested action. There is no authentication (EXC-0001).

## Decision

- **One action in this version: `create_project`.** Shape: `{ kind, payload, itemNames }`.
  `payload` has the fields of the create-project body (`name`, optional `description`, `priority`,
  `deadline` as `YYYY-MM-DD`, `items` of `{ partId, quantity 1..1000 }`, at most 100, each part
  once). `itemNames` is `{ partId, name }` for display only, names at most 100 characters, only
  for parts present in `payload.items`.
- **Second action (M4.3b): `create_queue`.** The proposal is a discriminated union on `kind`.
  Shape: `{ kind, payload: { projectId, goal, mode, printerIds }, projectName, printerNames }`.
  `payload` is the create-queue body of `queues.schemas.ts` WITHOUT `lines` (the queues API copies
  them from the project). `single` needs exactly 1 printer, `multi` 2 to 10, no repeats, 24-hex
  ids. `projectName` and each `printerNames` entry (`{ printerId, name }`, only for printers in
  `payload.printerIds`) are display text, 1 to 100 characters. After confirming, the browser sends
  `payload` to `POST /api/v1/queues`. Same rules as above: strict, dropped when invalid.
- **Third action (resume a paused project): `update_queue_progress`.** Shape:
  `{ kind, payload: { projectId, version, lines }, projectName, lineNames }`. `payload` mirrors the
  `PATCH /api/v1/queues/{projectId}` body of `queues.schemas.ts`: `version` is an integer of at
  least 1 (the one the assistant read), `lines` are 1 to 100 `{ partId, quantity 1..1000,
completed 0..quantity }`, each part once. `projectName` and `lineNames` (`{ partId, name }`, only
  for parts in `payload.lines`) are display text, 1 to 100 characters. After confirming, the
  browser sends `{ version, lines }` to the PATCH route, which stays the authority (400, 404, 409).
  The rules are duplicated in the chat module. Same rules as above: strict, dropped when invalid.
- **"Optimise" is not a proposal.** The optimiser is stateless and writes nothing, so the assistant
  gets it as a read tool (ADR 0030), not as something the user must confirm.
- **The API does not trust the assistant.** It parses the proposal with a strict Zod schema
  (`z.strictObject` everywhere, so unknown keys fail). The rules are duplicated from
  `projects.schemas.ts` in the chat module (a module does not import another's internals); the
  projects module stays the authority.
- **An invalid proposal is dropped, not an error.** The API answers `200` with the reply and
  `proposal: null`, and logs only the outcome (`none`, `valid`, `dropped`), never content.
- **The API never executes a proposal.** There is no confirm endpoint here. After the user clicks
  confirm, the browser sends the payload to `POST /api/v1/projects`, which validates it again.
- **The browser shows the description built from the validated payload and `itemNames`**, not the
  model's free text in `reply`.

## Threats

| Threat                                                   | Control                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged or injected proposal (prompt injection)           | Strict schema at the API; unknown shape is dropped. Even a valid one only does something if the user confirms.                                            |
| The model chooses wrong or invented part ids             | Ids are format-checked here; the projects module rejects parts that do not exist. The user sees `itemNames` before confirming.                            |
| Confirmation is faked by the model                       | Confirmation is a separate user action in the browser; the model output cannot trigger a request.                                                         |
| The model picks a wrong project or printer id (queue)    | The user sees `projectName` and `printerNames` before confirming. The real authority is `POST /api/v1/queues`, which re-validates and answers 400 or 409. |
| The model proposes the wrong project or lines (progress) | The user sees `projectName` and each line name with its quantity and completed count before confirming.                                                   |
| The queue changed since the assistant read it (progress) | `version` travels with the proposal; a stale one answers 409 on confirm, so a changed queue is never overwritten.                                         |
| The payload is tampered with after the check             | The API re-validates in `POST /api/v1/projects`, the real authority. The proposal check here is only an early filter.                                     |
| Replay of an old proposal                                | Residual: confirming twice creates two projects (project names are not unique). The browser clears the proposal after use.                                |
| Mass assignment (`status`, `id`, `version`...)           | `strictObject` rejects unknown keys at both the proposal and the projects body.                                                                           |
| Autonomous writes by the assistant                       | None: the assistant has read-only tools (ADR 0030) and the API has no write path driven by a proposal.                                                    |
| Misleading text in the confirmation                      | The confirmation text is built from the validated payload, not from model text.                                                                           |
| Oversized or hostile proposal                            | Bounded strings, at most 100 items and 100 names, the 10 000-character reply cap, and the global body limits.                                             |

## Consequences

- The response contract changes from `{ reply }` to `{ reply, proposal }` (always present).
- If the create-project rules change, the duplicated rules in `chat.schemas.ts` must follow; if
  they lag, the worst case is a dropped proposal or a 400 from the projects module on confirm.
- Replay protection (an idempotency key) is not added; revisit it with the second action. A
  non-400 failure on confirm may mean the project WAS created, so the UI warns the user to check
  Projects before retrying; there is no idempotency key yet.
