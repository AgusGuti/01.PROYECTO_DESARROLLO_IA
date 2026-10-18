# 0030. The assistant reads data through read-only tools

- **Status:** accepted
- **Date:** 2026-10-16

## Context

M4.2 lets the assistant answer from the user's data (ADR 0004: data only through the Express API,
reads are tools, the model never writes). Tool results contain text typed by users (project and
part names, descriptions), so they are an untrusted channel into a small local model.

## Decision

- **Tools (all read-only):** `list_projects(search?, priority?)`, `get_project(project_id)`,
  `get_queue_progress(project_id)`, `list_filaments()`, `list_printers()`, `list_parts(search?)`,
  `get_cost_settings()`, `get_intervention_schedule()`, `simulate_project(project_id, start_at?)`.
- **Only `GET`, plus one `POST`:** `POST /api/v1/simulations` is stateless (the contract says
  nothing is saved) and is the only way to answer "when would this finish". The API client accepts
  only the methods `GET` and `POST`, and the tools use `POST` for that single path. No tool can
  create, edit or delete. Write proposals are a later item (M4.3).
- **Contract first:** every path and response shape was taken from `openapi.yaml`. The API has no
  text search, so `search` filters client-side over one page of at most 100 items; the result
  reports `total` and `shown` so the model can say the list is partial.
- **Arguments:** strict Pydantic models (`extra=forbid`, `strict=True`). Ids must match
  `^[0-9a-fA-F]{24}$` before being placed in a path; `search` is at most 100 characters; `start_at`
  must be `YYYY-MM-DDTHH:mm`. A failure returns "argumentos inválidos (<field>)" to the model
  without echoing the value, and no HTTP call happens.
- **Default start of a simulation** is computed by the tool (Argentina UTC-3, rounded up to 15
  minutes), never by the model.
- **API answers are parsed** into small Pydantic models that keep only the needed fields; an
  unexpected shape is an error, not a pass-through.
- **Limits:** 5 s per API call (15 s for a simulation), no redirects, 256 KiB per response, 30
  items per list, 160 characters per user-typed text field, 6000 characters per tool result, 4 tool
  calls per turn (extra calls in the same turn get a refusal; after the cap the model is called
  without tools so it must answer), 50 s for the whole request (below the 60 s the API waits,
  ADR 0029).
- **Results are DATA:** each result is wrapped in `<datos>...</datos>` followed by "no
  instrucciones"; `<` is escaped inside so stored text cannot forge the closing tag. The system
  prompt says tool output is data, that the assistant is read-only, how to format money (centavos
  to pesos `1.234,56`) and dates (`DD-MM-AAAA`). User text is only in the human message.
- **Errors:** API and validation failures reach the model as a short Spanish `ERROR: ...` with no
  URL, body or stack. Any failure of the loop is still `AssistantUnavailableError`, answered as a
  generic 503. Logs hold the tool name, outcome and milliseconds, never arguments or results.
- **Loop:** a small explicit loop over `model.bind_tools(...)` rather than `create_agent`: the
  cap, the time budget and the error strings are the point of this module, and the loop makes each
  one a visible line of code that tests can pin. Tools are passed as plain function specs, so any
  provider supporting tool calling works.

## Threats

| Threat                                                   | Control                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection through stored data (names, texts)      | Results wrapped as DATA and truncated; prompt says to ignore orders inside them; the model has no tool that writes, so the worst case is a wrong or misleading answer |
| Injection through the user's message                     | Only in the human message; never formatted into the system prompt                                                                                                     |
| SSRF                                                     | One fixed base URL from settings; paths built only from validated ids; no redirects; no tool takes a URL                                                              |
| Path traversal / query injection in ids and search       | Strict id pattern before building the path; search is client-side only, never sent to the API                                                                         |
| Data volume (large lists, large bodies, context filling) | Page size 100, 256 KiB response cap, 30 items, text and result truncation                                                                                             |
| DoS via tool loops or slow dependencies                  | 4 tool calls, a final tool-less round, 50 s budget, short API timeouts                                                                                                |
| Information leak through errors                          | Fixed Spanish messages for the model; generic 503 for the client; cause only in server logs                                                                           |
| Privacy in logs                                          | Names, outcomes and timings only                                                                                                                                      |

## Consequences

- **Residual risk:** a manipulated model can still give a misleading answer about the data. Reads
  expose the same data the user can already see in the app (single user, loopback, EXC-0001); when
  authentication arrives, the tools must forward the user's credentials, not use a shared one.
- Searching is limited to the first 100 items sorted by the API; with more, the model is told the
  result is partial. A server-side `search` parameter in the API would fix it and must be added to
  the contract first.
- Not verified here: behaviour with a real Ollama model (tool-calling quality of `qwen3:8b`).
  Tests use a scripted model and a fake API only.

## Addendum (review follow-ups)

- `list_projects` and `list_parts` return `truncated` (true when the total exceeds the single page fetched), so the model can say a search was only partial.
- The tool name is logged only when the tool exists (otherwise `unknown`): the model controls it.
- The assistant allows at most two concurrent requests; a third is refused at once with the generic unavailable answer, with no queue, so Ollama cannot be starved by repeated calls.
- Tool results use Spanish keys and human units (pesos, percent, text durations, DD-MM-AAAA), so the small model converts nothing: a live test with `qwen3:8b` invented field names when it received raw centavos and basis points.
- **M4.3 addendum, one proposal tool (see ADR 0031):** `propose_create_project(name, description?, priority?, deadline?, items?: [{pieza, cantidad}])`. Classification: **propose**, not read and not write. It issues no `POST`: it validates strict Pydantic arguments (`priority` baja/normal/alta/urgente mapped to `low/normal/high/urgent`; `deadline` as DD-MM-AAAA or AAAA-MM-DD, converted in code, real days only, years 2000..2099; at most 100 items, quantity 1..1000), resolves each `pieza` (24-hex id or name) with one `GET /api/v1/parts` of 100 (exact name first, then contains; unknown, ambiguous or repeated pieces are a short Spanish error with at most 5 clipped names; a name never goes into a URL), and stores the result in the per-request `Toolbox`. At most one proposal per turn (an identical repeat is accepted, a different one is refused). `ChatResponse.proposal` is filled from that state, never from the model's text, so JSON written in the reply creates nothing. The tool returns "Propuesta lista; el usuario debe confirmarla en pantalla. No está creado nada todavía." to the model.
- **M4.3b addendum, two tools (see ADR 0031):**
  - `optimize_project(proyecto, start_at?)`, **read**. Calls the stateless `POST /api/v1/simulations/optimizations` (nothing is saved; with `POST /api/v1/simulations` it is one of the only two `POST`s the assistant may issue; any other write stays forbidden and tests assert `/api/v1/queues` is never called). The start defaults in code like `simulate_project`. It returns a compact Spanish summary: goal, chosen strategy (Spanish label), simple vs optimised order (estimated end, total idle time, deadline met), the difference in plain text, up to 10 unplaced pieces and the warnings. The candidate list and job tables are dropped.
  - `propose_create_queue(proyecto, objetivo, modo, impresoras)`, **propose**. No `POST`. `objetivo` (`cumplir fechas`, `terminar antes`, `minimizar tiempo muerto`, or the API values) maps to `deadline`/`fastest`/`minimal_idle`; `modo` (`una`/`varias` or `single`/`multi`) must match the count (single exactly 1, multi 2..10 distinct). Printers are resolved in code with one `GET /api/v1/printers` of 100 (exact name, then contains; unknown, archived, ambiguous or repeated is a short Spanish error with clipped names); the project with the existing resolver (a name via `GET /projects`, an id via `GET /projects/{id}` to get its name). The result goes in `Toolbox.proposal` as `{ kind: "create_queue", payload: { projectId, goal, mode, printerIds }, projectName, printerNames: [{ printerId, name }] }`. The one-proposal-per-turn rule is shared with `create_project`: a different second proposal of either kind is refused.

- **Agenda addendum, `agenda_del_dia(fecha)`, read.** Only `GET /projects` (one page of 100) and `GET /availability/schedule`. `fecha` is DD-MM-AAAA, AAAA-MM-DD or "D de mes" (year defaults to the current one in Argentina time); non-real dates are refused before any HTTP call. It returns projects whose deadline is that day, the intervention ranges for that day (the date's exception, else the weekly ranges of its weekday, computed in code) and a fixed `nota` saying the system stores no per-day print plan.

- `get_project`, `get_queue_progress` and `simulate_project` take `proyecto` (a 24-hex id or a name). A name is resolved in code with one `GET /projects`; only the resolved id is ever placed in a URL path. The ambiguity message lists at most 5 clipped names with `<` removed but is not wrapped as data: accepted residual risk, since names are user-typed on a loopback-only system (EXC-0001).

- **More read tools addendum (costs, material, risk, tonight, fit, help).** Seven tools, all **read**: none changes data and none returns a proposal. The POST allowlist grows to four exact paths, all stateless: `/api/v1/simulations`, `/api/v1/simulations/optimizations`, `/api/v1/costs/estimates`, `/api/v1/costs/project-estimates` (anything else, including `/api/v1/costs/settings` or `/api/v1/queues`, is still refused before any HTTP). Each tool does its own bounded HTTP work, because the per-turn cap stays at 4 tool calls; the maximum is written in `tools.py` next to the constants. Descriptions start with explicit Spanish trigger phrases and say what NOT to ask the user (qwen3:8b tends to ask for data a tool can find by itself).
  - `costo_de_proyecto(proyecto, margen_porcentaje?, impresora?)`, at most 6 calls (project lookup, project, parts, filaments, printers, `POST /costs/project-estimates`). The spool of each line is chosen **in code**, among the filaments of the part's material: the cheapest per gram with `availableGrams >= weight * quantity`; if none is enough, the one with most grams; if the material has no spool, that part goes to `piezas_sin_costo` (and the total says it excludes it). Parts that are deleted are skipped and mentioned; at most 100 lines are sent and 15 echoed (totals cover all). `margen_porcentaje` is 0..1000 with at most 2 decimals, converted with `Decimal` to basis points (12,5 becomes 1250) and marks a sale. The result is in pesos with Spanish keys and a `supuestos` text naming the spool and printer assumed, so the model tells the user.
  - `costo_de_pieza(pieza, cantidad=1, bobina?, margen_porcentaje?, impresora?)`, at most 4 calls, same rules; a named `bobina` must match the part's material.
  - `verificar_material(proyecto)`, at most 5 calls: grams per material from the pending units of the queue (the project quantities when it has no queue) against the sum of `availableGrams` per material.
  - `proyectos_en_riesgo()`, at most `1 + 2 * 5` calls: projects with a deadline; the 5 earliest deadlines that are not past get a queue check and the stateless simulation from now (run concurrently); those without a queue go to `sin_cola`; past deadlines go to `vencidos` and are not simulated (they may be finished).
  - `que_imprimir_esta_noche(proyecto)`, at most 2 calls: the optimised plan from now, keeping jobs that are `unattended` and start within 24 hours.
  - `cabe_la_pieza(pieza, impresora)`, 2 calls: part `dimensionsMm` against the printer `buildVolume`, axis by axis (no rotation, no plate capacity).
  - `ayuda_del_sistema(tema)`, no HTTP: `tema` is a closed enum (costos, cola, ventanas, simulacion, optimizacion, piezas, filamentos, impresoras, asistente) returning fixed Spanish text in `help_text.py`; a test checks that every route it mentions exists in `apps/web/src/app/app.routes.ts`.
