# 0035. The assistant imports G-code through the MCP server, after the user confirms

- **Status:** accepted (amends 0004 and 0031; builds on 0034)
- **Date:** 2026-10-21

## Context

ADR 0034 added a local MCP server that scans a folder of `.gcode` files and imports them as
parts, and the web has a screen for the same job. The user also wants to do it from the chat:
"importá la carpeta Minis como PLA".

That collides with ADR 0004 in two places: (1) every assistant capability must first exist as an
API endpoint, and a folder of files on the disk is not an API endpoint; (2) the assistant never
performs a write, the browser does (0031). Both are deliberate and this ADR bends them as little
as possible.

## Decision

- **Read, bounded exception.** The assistant may read ONE local folder, the one in `GCODE_ROOT`,
  through the MCP server of ADR 0034, and only as a dry run (`scan_gcodes`). It is a read tool
  like the others (0030). The folder is configuration (`apps/assistant/src/assistant/config.py`),
  never a tool argument. Unset `GCODE_ROOT` means the tools do not exist and the assistant
  behaves as before.
- **Write, one action.** The assistant may EXECUTE exactly one write: `import_gcodes`. It
  happens only after the user's explicit click on the confirmation card, and the model has no
  tool that reaches it:
  1. The model calls `propose_import_gcodes(material, carpeta?)`. It builds a proposal
     `{ kind: "import_gcodes", payload: { material, folder? } }` in code (0031). Nothing runs.
  2. The API validates the proposal strictly and the web shows a card built from the validated
     payload.
  3. The click makes the BROWSER call `POST /api/v1/gcode-imports`. The API validates it again
     and forwards it to the assistant's `POST /gcode-imports`, which starts the MCP server with
     `confirm: true`. That route is an HTTP route, not a model tool.
  4. The MCP server still goes through the API for every file (0034), so the parts API remains
     the authority on what a valid part is.
- **Same confirmation principle as 0031:** confirmation is a separate user action outside the
  model. The only change is WHO sends the confirmed request: the API forwards it to the assistant
  instead of the browser calling the resource endpoint, because there is no resource endpoint for
  "a folder on the disk".
- **One material per batch,** chosen by the user (0034). No default is invented.
- **Idempotent.** Parts already imported from the same file are updated or left alone, so
  confirming again after a timeout cannot duplicate parts. The UI says so.
- **Limits.** Scan 40 s inside the chat time budget; the model sees at most 15 file rows plus
  counts. Import 300 s in the assistant, 330 s in the API. At most 1000 files (0034).
- **Dependency.** `mcp` (the official Python SDK, MIT, `modelcontextprotocol` organisation),
  pinned `>=1.30,<2`. `langchain-mcp-adapters` was not needed: it converts MCP tools into
  LangChain tools, and this assistant has its own tool layer (0030).
- **Amendment of 0004:** the "Reads are tools; writes are proposals" rule stays, with the two
  exceptions above, and no others.

## Threat model

| Threat                                                                     | Control                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection through file names reaching the model                     | Names are untrusted text: parsed with a model, reduced to five known outcomes, only printable characters, 80 characters each, 15 rows, wrapped as `<datos>` with `<` escaped. The system prompt says they are data. |
| The model imports without the human click                                  | It has no import tool (tested: `import_gcodes` is an unknown tool). `propose_import_gcodes` only fills a proposal. The execution route is not a tool and is called by the API after a browser request.              |
| The model or a client picks another directory                              | The root is `GCODE_ROOT`, passed as `--root` by the assistant. `folder` is relative, no `..`, no absolute path or drive, no control characters, checked in Zod, Pydantic and the MCP server (containment).          |
| A forged proposal                                                          | Strict schema at the API; an invalid one is dropped (0031). A valid one does nothing until the click.                                                                                                               |
| A forged `POST /api/v1/gcode-imports` or `/gcode-imports` on the assistant | Same as any API call in this version: no authentication (EXC-0001), loopback only. Residual: any local process can trigger an import of the configured folder; it can only create parts from files already there.   |
| Hostile `.gcode` content                                                   | Only the first 64 KB is read as text and analysed by the API (0014); nothing is executed. Symbolic links are skipped.                                                                                               |
| Wrong material for a batch                                                 | The card shows the material before the click; edit the parts afterwards.                                                                                                                                            |
| Resource exhaustion (huge folder, slow API)                                | 1000 files, one at a time, timeouts at every hop, at most 2 concurrent chat requests; the import ceiling is 300 s.                                                                                                  |
| Information leak in errors and logs                                        | The model and the browser get fixed Spanish messages; logs hold counts, timings and exception types, never file names.                                                                                              |
| Replay of the confirmation                                                 | Residual and harmless: the import is idempotent. The card accepts one confirmation.                                                                                                                                 |

## Consequences

- The assistant is the first service that starts a child process (the MCP server, with the
  `node` found on `PATH`). The container image does not ship `scripts/mcp`, so there the
  feature is off unless `GCODE_ROOT` and the script are both available.
- The chat API contract has a fourth proposal kind and a new route, `POST /api/v1/gcode-imports`.
- A real local model choosing these tools well is not covered by automated tests (they fake the
  model); it needs a manual check.
