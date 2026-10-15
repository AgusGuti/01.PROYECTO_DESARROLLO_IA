# Roadmap

Source of requirements: [the project proposal](propuesta-proyecto-impresion-3d.md) (CU01–CU10).
One item at a time, each through the `new-feature` workflow, each merged by pull request with
green CI before the next starts.

**Current:** M2.1 – CU03 Calcular costo de una impresión (design in progress). M1 (CU06, CU05, CU02, CU01) is merged.

The session-start hook reads the line above. Update it when an item is merged.

## M0. Environment and skeleton — done

AI environment, guard rails, runnable API / web / assistant skeleton, quality gates, CI.

## M1. Gestión

The data everything else depends on. Simple resources first, so the full layered pattern is
learned on easy ground before the hard parts.

| #    | Use case                                    | Notes                                                                                                                                           |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M1.1 | **CU06** Registrar impresoras               | First real module: it sets the pattern every other module copies. Build volume, nozzle, compatible materials, status.                           |
| M1.2 | **CU05** Gestionar inventario de filamentos | Stock that decreases: the first place an atomic conditional update matters.                                                                     |
| M1.3 | **CU02** Gestionar piezas y modelos         | Reused across projects. The model **file upload** needs the `threat-model` skill; consider shipping metadata first and the file as a follow-up. |
| M1.4 | **CU01** Registrar proyecto de impresión    | References parts with quantities; priority and optional deadline.                                                                               |

## M2. Costos

| #    | Use case                                      | Notes                                                                                                                                                                                   |
| ---- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2.1 | **CU03** Calcular costo de una impresión      | Pure domain logic: filament, time, electricity, other costs, optional margin. Money as integers. The formula and its configurable parameters need Agustín's confirmation before coding. |
| M2.2 | **CU04** Consultar costo total de un proyecto | Aggregates M2.1 over a project's parts and quantities, plus material required.                                                                                                          |

## M3. Planificación

The core of the product and its hardest part.

| #    | Use case                                 | Notes                                                                                                                                                                                                                               |
| ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3.1 | **CU09** Definir ventanas de impresión   | The constraint model the optimiser consumes. Decide the window types that really change behaviour.                                                                                                                                  |
| M3.2 | **CU07** Crear cola de impresión         | Selects pending pieces into jobs: the optimiser's input.                                                                                                                                                                            |
| M3.3 | **CU10** Simular la planificación        | The timeline view and the schedule data structure, first with a naive ordering. Gives something visible to compare the optimiser against.                                                                                           |
| M3.4 | **CU08** Optimizar el orden de impresión | Pure domain code, no I/O. Start with an explainable heuristic and a measured baseline (idle time, deadlines met). Property tests: no overlap, no intervention needed inside a no-intervention window, every job placed or reported. |

Open questions to settle with Agustín before M3 (do not assume answers):

- Is an intervention needed only at the _end_ of a print (remove the piece, start the next), or
  also at the start?
- Can identical small pieces be batched on one plate, and does that change duration?
- One printer or several in the first version of the optimiser?
- What is optimised first when goals conflict: deadlines, priority, or idle time?
- Time zone and the planning horizon (one day, several days).

## M4. Chat assistant

After M1–M3 are merged and tested. See [ADR-0004](../adr/0004-chat-assistant-boundaries.md).

| #    | Item                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------- |
| M4.1 | API endpoint that forwards chat to the assistant; chat panel in Angular.                        |
| M4.2 | Read tools: projects, costs, stock, schedule.                                                   |
| M4.3 | Proposal tools with confirmation in the UI: create a project, queue jobs, re-run the optimiser. |

## Later

- **Authentication and per-user data**, which closes
  [EXC-0001](../exceptions/EXC-0001-no-authentication-yet.md). Required before the system is
  reachable from any other machine.
- The proposal's future improvements: recording finished and failed prints, automatic
  rescheduling after a failure, estimated versus real cost, print history, project summary.
- Deployment (hosting, TLS, backups with a tested restore, monitoring).
