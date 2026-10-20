# Print3D Planner

Sistema web para gestionar proyectos de impresión 3D FDM, calcular sus costos y optimizar la cola
de impresión según las horas en que alguien puede atender la impresora.

Trabajo práctico integrador de _Arquitectura de Agentes y AI-Augmented Software Engineering_
(UNLa). Autor: Agustín Adrián Gutiérrez ([@AgusGuti](https://github.com/AgusGuti)).
Toda la programación operativa se delegó a agentes de IA (Claude Code y OpenCode) trabajando
dentro de un entorno que los obliga a respetar un estándar de ingeniería.

**Estado:** los 10 casos de uso y el asistente de chat están implementados y mergeados. Pendiente:
revisión manual de cada pantalla, autenticación y despliegue (ver [roadmap](docs/product/roadmap.md)).

## Índice

1. [Qué hace el sistema: los 10 casos de uso](#1-qué-hace-el-sistema-los-10-casos-de-uso)
2. [Arquitectura](#2-arquitectura)
3. [Asistente inteligente (LangChain)](#3-asistente-inteligente-langchain)
4. [AI Engineering: cómo se construyó](#4-ai-engineering-cómo-se-construyó)
5. [Servidores MCP](#5-servidores-mcp)
6. [Cómo ejecutarlo](#6-cómo-ejecutarlo)

## 1. Qué hace el sistema: los 10 casos de uso

Detalle completo, con reglas de negocio, en [la propuesta](docs/product/propuesta-proyecto-impresion-3d.md).

| ID   | Caso de uso                          | Qué resuelve                                                                                                                                         | Pantalla          |
| ---- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| CU01 | Registrar proyecto de impresión      | Un proyecto agrupa piezas con cantidades, prioridad, fecha límite y objetivo de optimización. Se puede pausar y reanudar con el progreso registrado. | Proyectos         |
| CU02 | Gestionar piezas y modelos           | Catálogo de piezas reutilizables con su configuración de impresión. Lee el encabezado de un G-code de Cura para tomar tiempo y gramos.               | Piezas            |
| CU03 | Calcular costo de una impresión      | Filamento + energía + desgaste + costos fijos, con margen opcional para venta. Aritmética en enteros y redondeo explícito.                           | Costos            |
| CU04 | Consultar costo total de un proyecto | Suma el costo de cada línea por cantidad y el material total necesario, contra el stock disponible.                                                  | Proyectos → costo |
| CU05 | Gestionar inventario de filamentos   | Bobinas con material, color, peso restante y precio. El stock se descuenta con una actualización atómica.                                            | Filamentos        |
| CU06 | Registrar impresoras                 | Volumen de impresión, boquilla, materiales compatibles, consumo y estado.                                                                            | Impresoras        |
| CU07 | Crear cola de impresión              | Convierte las piezas pendientes de un proyecto en trabajos asignables a impresoras.                                                                  | Colas             |
| CU08 | Optimizar el orden de impresión      | Heurística greedy con varias estrategias, medida contra el plan ingenuo (tiempo ocioso, fechas límite cumplidas).                                    | Planificación     |
| CU09 | Definir ventanas de impresión        | Horario semanal en que el usuario puede intervenir (inicio y fin de cada impresión), más ausencias puntuales.                                        | Disponibilidad    |
| CU10 | Simular la planificación             | Línea de tiempo de cómo quedaría la producción antes de empezar.                                                                                     | Simulaciones      |

Además: un **chat** con el asistente (sección 3) y una página de **estado del sistema**.

## 2. Arquitectura

```text
 Navegador ──► Angular 22 (apps/web) ──HTTP──► Express 5 API (apps/api) ──► MongoDB 8
                                                   │  ▲
                                         /chat     ▼  │ solo vía la API
                                           Asistente FastAPI + LangChain (apps/assistant) ──► Ollama (LLM local)
```

| Parte     | Tecnología                                  | Carpeta                  |
| --------- | ------------------------------------------- | ------------------------ |
| Web       | Angular 22, standalone components, signals  | `apps/web`               |
| API       | Node.js 22, Express 5, TypeScript, Zod      | `apps/api`               |
| Datos     | MongoDB 8 con Mongoose, en Docker           | `docker-compose.yml`     |
| Asistente | Python 3.12, FastAPI, LangChain, Ollama     | `apps/assistant`         |
| Contrato  | OpenAPI 3.1 generado desde los esquemas Zod | `packages/api-contracts` |

**Monolito modular en capas** ([ADR-0001](docs/adr/0001-layered-modular-monolith-in-one-repository.md)).
Cada funcionalidad de negocio es una carpeta en `apps/api/src/modules/<nombre>/` con las mismas
capas, y las dependencias apuntan en un solo sentido: HTTP → servicio → dominio.

| Archivo           | Responsabilidad                                                 |
| ----------------- | --------------------------------------------------------------- |
| `*.routes.ts`     | URL → método del controlador                                    |
| `*.controller.ts` | valida la entrada con Zod, llama al servicio, arma la respuesta |
| `*.service.ts`    | el caso de uso: coordina reglas, repositorios y transacciones   |
| `*.domain.ts`     | reglas de negocio puras, sin frameworks (fáciles de testear)    |
| `*.repository.ts` | todo el acceso a MongoDB; devuelve objetos planos               |
| `*.mapper.ts`     | modelo interno → DTO de respuesta                               |
| `*.schemas.ts`    | esquemas Zod: validación **y** fuente del contrato OpenAPI      |

Módulos: `printers`, `filaments`, `parts`, `gcode`, `projects`, `costs`, `availability`,
`queues`, `planning`, `simulations`, `chat`, `health`. Un módulo usa a otro solo a través de su
`index.ts` o de puertos inyectados desde `app.ts` ([ADR-0017](docs/adr/0017-modules-collaborate-through-ports-injected-from-app.md)).

Decisiones transversales, cada una con su ADR en [docs/adr](docs/adr/) (33 en total):

- **Contrato generado:** los tipos del frontend salen del mismo esquema que valida el backend ([0002](docs/adr/0002-api-contract-generated-from-zod-schemas.md)).
- **Concurrencia optimista:** cada edición lleva una versión; si otro cambió el documento, responde 409 ([0008](docs/adr/0008-optimistic-concurrency-for-edits.md)).
- **Dinero en enteros** (centavos, BigInt), redondeo half-up una sola vez por línea ([0011](docs/adr/0011-conventions-for-calendar-dates-and-money.md), [0019](docs/adr/0019-cost-arithmetic-is-bigint-rounded-half-up-once-per-line.md)).
- **Zona horaria fija** America/Argentina/Buenos_Aires, horizonte de 14 días ([0024](docs/adr/0024-the-intervention-schedule-is-one-versioned-document-in-a-fixed-time-zone.md)).
- **Errores** en formato RFC 9457 (problem details), sin stack traces ni mensajes del driver.

## 3. Asistente inteligente (LangChain)

Panel de chat en la web que responde en castellano sobre los datos reales del sistema.

- **Modelo:** LLM local vía Ollama (por defecto `qwen3:8b`), orquestado con LangChain 1.x y
  _tool calling_.
- **Frontera:** el asistente no toca la base de datos; lee y propone solo a través de la API
  ([ADR-0004](docs/adr/0004-chat-assistant-boundaries.md), [0029](docs/adr/0029-the-chat-endpoint-forwards-one-message-to-the-assistant.md)).
- **Herramientas de lectura** ([ADR-0030](docs/adr/0030-the-assistant-reads-data-through-read-only-tools.md)):
  listar proyectos, piezas, filamentos e impresoras; costo de una pieza o proyecto; verificar
  material; agenda del día; qué imprimir esta noche; proyectos en riesgo de no llegar a fecha;
  si una pieza entra en una impresora; simular y optimizar un proyecto; ayuda del sistema.
- **Herramientas de propuesta** ([ADR-0031](docs/adr/0031-assistant-proposals-need-user-confirmation.md)):
  crear un proyecto, crear una cola, registrar progreso. El asistente **propone** y el usuario
  **confirma** en la interfaz; el modelo nunca escribe datos por su cuenta.
- La salida del modelo se trata como entrada no confiable: se valida con Pydantic antes de usarla.
- **Defensa contra prompt injection:** el system prompt indica que lo que devuelven las
  herramientas son datos, nunca instrucciones (un nombre de pieza puede contener texto malicioso).

## 4. AI Engineering: cómo se construyó

### 4.1 La idea central

El objetivo del entorno fue que los agentes respeten buenas prácticas **incluso cuando se les pide
desviarse**. Un prompt solo no alcanza, así que cada regla verificable por máquina se aplica con
una máquina (lint, tipos, reglas de arquitectura, tests, hooks, CI), y las capas de IA se apoyan
encima para frenar el error antes y explicarlo
([ADR-0003](docs/adr/0003-three-layer-enforcement-of-the-standard.md)). Detalle operativo en
[docs/ai/README.md](docs/ai/README.md).

### 4.2 Cómo se estructuraron las instrucciones

| Capa                    | Archivo                                                                                    | Qué aporta                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estándar (la autoridad) | [docs/standards/mean-engineering-standard.md](docs/standards/mean-engineering-standard.md) | Reglas MUST/SHOULD numeradas por sección (§n); todo lo demás lo cita.                                                                                                  |
| Instrucciones núcleo    | [AGENTS.md](AGENTS.md) (importado por [CLAUDE.md](CLAUDE.md))                              | Resumen del estándar, capas, comandos, flujo de trabajo y el **protocolo de pushback**.                                                                                |
| Reglas por tema         | `.claude/rules/*.md`                                                                       | API, web, datos, testing, seguridad, asistente; se cargan según la ruta del archivo editado.                                                                           |
| Agentes por rol         | `.claude/agents/*.md` (sincronizados a `.opencode/agents/`)                                | `architect`, `backend-api`, `data-mongodb`, `angular-frontend`, `assistant-python`, `qa`, `devops-sre`, `code-reviewer`. Los de diseño y revisión son de solo lectura. |
| Skills (flujos)         | `.claude/skills/*/SKILL.md`                                                                | `new-feature`, `new-api-module`, `new-web-feature`, `mongo-model`, `assistant-tool`, `threat-model`, `adr`, `verify`, `request-exception`.                             |
| Contexto de sesión      | hook `session-start`                                                                       | Inyecta la rama, el ítem actual del roadmap y las excepciones vigentes al abrir cada sesión.                                                                           |

### 4.3 Prompts clave

- **Protocolo de pushback** ([AGENTS.md](AGENTS.md)): ante un pedido que rompe una regla, el agente
  nombra la regla, explica la consecuencia en lenguaje simple, ofrece la alternativa correcta con
  su costo y **no** debilita ningún gate. La única salida es una excepción escrita que acepta el
  humano ([docs/exceptions](docs/exceptions/)).
- **"Enseñá mientras trabajás":** la primera vez que aparece un concepto (middleware, signals,
  índices, transacciones) el agente lo explica en dos o tres oraciones.
- **Honestidad sobre la verificación:** prohibido decir que algo pasó sin haberlo ejecutado.
- **`new-feature`:** el prompt que guía cada caso de uso en pasos que el humano puede corregir
  antes de que haya código: criterios de aceptación → diseño (`architect`) → plan de tests (`qa`)
  → implementación de atrás hacia adelante → verificación → revisión (`code-reviewer`) → PR.
- **System prompt del asistente** (`apps/assistant/src/assistant/chat.py`): responder solo con
  datos obtenidos por herramientas y proponer en lugar de actuar.

### 4.4 Metodología de iteración

Un caso de uso por vez, en el orden del [roadmap](docs/product/roadmap.md) (primero lo simple
para aprender el patrón, después costos, después planificación, al final el chat). Cada uno en su
rama, con Conventional Commits, y mergeado por pull request con CI en verde. Cada decisión difícil
de revertir quedó como ADR. Se usó el modelo más fuerte para diseño, optimizador y revisión, y
modelos más baratos (OpenCode) para cambios chicos y bien especificados: los gates no dependen de
qué modelo escribió el código.

### 4.5 Loops de autocorrección automatizados

| Momento              | Mecanismo                                               | Efecto                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Al recibir el pedido | hook `user-prompt`                                      | Si el pedido suena a "salteá los tests", le recuerda al agente aplicar el pushback.                                                                                                      |
| Antes de editar      | hook `pre-edit` + `scripts/ai/guards`                   | Bloquea `any`, `@ts-ignore`, frameworks en el dominio, `req.body` a un modelo, escribir `.env`… con un mensaje que cita la regla.                                                        |
| Antes de un comando  | hook `pre-command`                                      | Bloquea `--no-verify`, commits en `main`, `--force`, instalaciones globales.                                                                                                             |
| Después de editar    | hook `post-edit`                                        | Formatea y lintea el archivo, y lo vuelve a pasar por los guards completo.                                                                                                               |
| Antes de terminar    | hook `stop` → `npm run verify:quick`                    | **El agente no puede terminar** si los gates rápidos fallan: tiene que leer el error y corregir.                                                                                         |
| Commit / push        | Husky + commitlint + lint-staged                        | Mismos chequeos para humanos y agentes.                                                                                                                                                  |
| Pull request         | GitHub Actions: `npm run verify` (19 gates) + tests e2e | Formato, lint, tipos, arquitectura (dependency-cruiser), contrato al día, tests unitarios, de integración con MongoDB real, web, Python, auditoría de dependencias, escaneo de secretos. |

En OpenCode el mismo motor de guards corre como plugin (`.opencode/plugins/guard.js`) y los
permisos están en [opencode.json](opencode.json).

## 5. Servidores MCP

El Model Context Protocol permite que el agente use herramientas de su entorno con una interfaz
estándar. Se configuran en [.mcp.json](.mcp.json), con versiones fijas instaladas dentro del
proyecto (nada global), y se habilitan en `.claude/settings.local.json` (`enabledMcpjsonServers`).

| Servidor      | Origen                                 | Configuración                                                                        | Rol en el desarrollo                                                                                                                                                                      |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context7`    | **Externo** (Upstash), servicio remoto | `node node_modules/@upstash/context7-mcp/dist/index.js` (v4.4.1)                     | Trae documentación actualizada de Express 5, Zod 4, LangChain 1.x, Mongoose, etc. Evita que el agente use APIs de versiones viejas que recuerda de su entrenamiento.                      |
| `angular-cli` | Oficial de Angular, local              | `node node_modules/@angular/cli/bin/ng.js mcp --read-only --root apps/web` (v22.2.2) | Lista los proyectos del workspace, da las buenas prácticas específicas de Angular 22 y busca en la documentación oficial. En modo **solo lectura**: no puede generar ni modificar código. |

Uso concreto: [CLAUDE.md](CLAUDE.md) indica consultar estos servidores en lugar de adivinar, y los
agentes los usan antes de escribir código de un framework que cambió entre versiones.

## 6. Cómo ejecutarlo

Requisitos: Node.js 22 (≥ 22.22.3), Python 3.12, Docker Desktop, Git y [Ollama](https://ollama.com)
con el modelo del asistente. Todo lo demás se instala dentro de esta carpeta o en Docker.

```bash
npm run bootstrap   # instala todo localmente y levanta MongoDB
npm run doctor      # verifica la máquina; indica cómo resolver cada problema
npm run dev         # web http://localhost:4200 · API http://127.0.0.1:3000 · asistente :8000
```

| Comando                                                               | Qué hace                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| `npm run verify:quick` / `npm run verify`                             | gates rápidos / todos los gates                      |
| `npm run contract`                                                    | regenera el contrato OpenAPI tras cambiar un esquema |
| `npm run test:api` · `test:int` · `test:web` · `py:test` · `test:e2e` | suites de tests individuales                         |
| `npm run db:up` · `db:down` · `db:shell`                              | MongoDB en Docker                                    |

Más detalle y solución de problemas: [runbook del entorno local](docs/runbooks/local-environment.md).

> **Seguridad:** todavía no hay autenticación
> ([EXC-0001](docs/exceptions/EXC-0001-no-authentication-yet.md)). Por eso la API, el asistente y
> MongoDB escuchan solo en `127.0.0.1`. **No exponer ni desplegar** hasta cerrar esa excepción.
