# 0034. Bulk G-code import is a local MCP server that goes through the API

- **Status:** accepted
- **Date:** 2026-10-21

## Context

There are about 290 `.gcode` files in `D:\3D_Printings\00.GCODES`. Creating a part from each one
in the web form is one file at a time. The user wants an agent to read the folder and create the
parts in bulk.

## Decision

- A local MCP server, `scripts/mcp/gcode-import-server.mjs` (stdio, declared in `.mcp.json`), with
  two tools: `scan_gcodes` (dry run, read-only) and `import_gcodes` (needs `confirm: true`).
- It does **not** touch MongoDB. For each file it sends the first 64 KB to
  `POST /gcode-analyses` (ADR 0014) and then creates or updates the part with `POST/PATCH /parts`,
  so the analysis and every validation are the ones the web form already uses.
- **Material:** one per batch, chosen by the user. A G-code file does not state it (ADR 0015).
- **Identity:** the file path relative to the root is stored in `source.fileName`. A re-run
  finds the part by it: identical data is left alone, changed data is refreshed with the part's
  `version` (ADR 0008). The name is never overwritten, because the user may have renamed it.
- A file without dimensions, weight, layer height or time is reported as skipped, not guessed.
- New dependency: `@modelcontextprotocol/sdk` 1.32.1 (devDependency, exact), the official SDK;
  hand-writing the protocol would be more code and more risk.

## Threat model (files + integration)

- Folder content is hostile: only regular `.gcode` files are read (symbolic links are skipped),
  at most 1000 files, only the first 64 KB, never executed. `folder` cannot leave the root.
- The API response is parsed with a schema before use. Timeouts on every request.
- It talks to `127.0.0.1:3000` only (EXC-0001). The root is a command-line argument, not a tool
  input, so the agent cannot point it at another directory.
- Writes require `confirm: true` and Claude Code asks permission for the MCP call; the dry run
  comes first. Residual risk: a wrong material for a batch creates parts to fix by hand.

## Consequences

Parts imported this way and parts created in the web form for the same file do not match (the
web stores the bare file name). Acceptable: the import is meant for the initial load.
