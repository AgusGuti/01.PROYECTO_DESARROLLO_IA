# 0029. The chat endpoint forwards one message to the assistant

- **Status:** accepted
- **Date:** 2026-10-16

## Context

M4.1 connects the browser to the assistant (ADR 0004): the browser talks only to the Express API,
which forwards the chat request. The assistant answers `POST /chat {message}` with `{reply}`, `413`
when the message is too long and `503` when the model fails. There is no authentication (EXC-0001),
so both services listen on the loopback interface only.

## Decision

- **Stateless:** `POST /api/v1/chat`, strict body `{ message }`, trimmed, 1..2000 characters (the
  API enforces its own limit, whatever the assistant allows). `200 { reply }`. Nothing is stored;
  there is no conversation history yet.
- **Consumer-owned port:** the module defines `AssistantClient { ask(message): Promise<string> }`.
  The implementation uses the global `fetch` to `config.assistantUrl + '/chat'` (a fixed path; no
  part of the URL comes from a client), with `AbortSignal.timeout(60 s)` (a named constant, the
  model is slow on modest hardware), `redirect: 'error'` and no retry (a call spends model time
  and is not safely repeatable).
- **The reply is untrusted:** parsed with a Zod schema (`{ reply: non-empty string }`) and capped at
  10 000 characters.
- **Errors:** assistant `413` becomes `400` with issue path `message`. Unreachable, timeout, any
  non-2xx, a body that is not JSON or not the expected shape, or an oversized reply become
  `503 service_unavailable` with a fixed message; the assistant's text and the network error are
  never returned.
- **Logs:** one line per call with outcome, message length, reply length and milliseconds. Never
  the message or the reply.
- **Rate limiting:** only the global limiter exists (`RATE_LIMIT_*`, 300 per minute). No stricter
  per-route pattern exists, so none is added (§1.2).

## Threats

| Threat                                              | Control                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Prompt injection through the user text              | Contained by the assistant (ADR 0004): user text only in a human message, model cannot write. |
| SSRF: making the API call an arbitrary URL          | Fixed URL from configuration; no client value in it; redirects are refused.                   |
| Amplification: large input, long or hung calls      | 2000-character body schema, global body limit, 60 s timeout, 10 000-character reply cap.      |
| Information leak through errors                     | Generic problem details; cause kept only in the server-side error, not in the response.       |
| Privacy: conversation content ending up in the logs | Only sizes, timings and outcome are logged.                                                   |
| Model-time exhaustion by repeated calls             | Residual risk, see below.                                                                     |

## Consequences

- **Residual risk:** the global limit (300 requests per minute) is far above what a local model can
  serve, so a client in a loop can queue work in the assistant. Accepted for now because EXC-0001
  keeps the API on loopback with one user. A stricter chat-specific limit (or a concurrency cap)
  must be added before the API is reachable from a network, together with authentication.
- The module depends on nothing but `config.assistantUrl`; tests inject a fake client or point the
  URL at a local fake server.
