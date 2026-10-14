---
name: threat-model
description: Runs a short, structured threat analysis for a feature before it is designed. Use for anything involving authentication, roles, file upload, money or pricing, external integrations, the chat assistant gaining a tool, administration functions, or sensitive personal data.
---

# Threat model

Standard §8.5. Fifteen minutes here is cheaper than a redesign. Keep it specific to the feature;
a generic checklist is not a threat model.

## 1. What are we protecting?

- **Assets:** the data and capabilities that matter (project data, cost and price data, the
  ability to change the schedule, stored model files, the host machine, the model's tool access).
- **Actors:** who can reach the feature, including ones we do not intend (another program on
  the same machine while EXC-0001 holds; a hostile file; text that the model reads).
- **Trust boundaries:** where data crosses from less trusted to more trusted: browser → API,
  API → assistant, model output → tool call, uploaded file → disk or parser.
- **Data flow:** a short text diagram.

## 2. What can go wrong?

Walk each boundary with these questions and write the concrete scenario, not the category:

| Question                                                | Typical examples here                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| Can someone reach or change something they should not?  | another user's project by id (BOLA/IDOR) once users exist            |
| Can a client set a field it should not?                 | mass assignment of `status`, `cost`, `version`                       |
| Can input change the meaning of a query or command?     | operator injection, unescaped regex, path traversal in a file name   |
| Can input make the system work too hard?                | huge body, unbounded list, an optimiser input that explodes run time |
| Can a secret or internal detail leak?                   | error text, logs, a prompt, the frontend bundle                      |
| Can a request be replayed or repeated harmfully?        | double submit creating two jobs, retry of a non-idempotent call      |
| Can the server be made to call somewhere it should not? | a client-supplied URL (SSRF)                                         |
| Can text steer the model?                               | prompt injection from a part description or a tool result            |
| Can a file harm us?                                     | oversized upload, wrong type, executable content, zip bomb           |

Use the OWASP API Security Top 10 as a prompt for scenarios you missed, not as the analysis.

## 3. What will we do about it?

For each scenario: the control (validation, limit, allowlist, authorisation check, confirmation
step, isolation), where it lives in the code, and **the test that proves it**.

## 4. What remains?

List residual risks plainly. Each one is either accepted by Agustín (record it in the ADR, or as
an `EXC` if it breaks a MUST) or sent back to step 3.

## Output

A section in the feature's ADR with: assets and boundaries, the scenario table (scenario,
control, test), and residual risks with who accepted them. Hand the test column to the `qa` agent.
