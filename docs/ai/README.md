# The AI development environment

How the agents, skills, rules and guards in this repository work, and how to work with them.
The reasoning behind the design is in
[ADR-0003](../adr/0003-three-layer-enforcement-of-the-standard.md).

## The idea in one paragraph

You asked for an environment that keeps you on good practices even when you try to leave them.
A prompt cannot do that on its own, so each rule from
[the engineering standard](../standards/mean-engineering-standard.md) that a machine can check is
enforced by a machine: lint, the type checker, architecture rules, tests, git hooks and CI.
The AI layers sit on top. They stop a mistake earlier and explain it.

## What is where

| Piece                            | Location                                                                                                | Used by                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Core instructions                | `AGENTS.md`                                                                                             | every AI tool                        |
| Claude-specific notes            | `CLAUDE.md` (imports `AGENTS.md`)                                                                       | Claude Code                          |
| Topic rules, loaded by file path | `.claude/rules/*.md`                                                                                    | Claude Code; OpenCode loads them all |
| Role agents                      | `.claude/agents/*.md` → generated `.opencode/agents/`                                                   | both                                 |
| Skills (workflows)               | `.claude/skills/*/SKILL.md`                                                                             | both (OpenCode reads this folder)    |
| Guard logic and its tests        | `scripts/ai/guards/`                                                                                    | hooks, plugin, `npm run guard:scan`  |
| Claude Code hooks                | `.claude/hooks/`, wired in `.claude/settings.json`                                                      | Claude Code                          |
| OpenCode plugin and permissions  | `.opencode/plugins/guard.js`, `opencode.json`                                                           | OpenCode                             |
| Documentation servers (MCP)      | `.mcp.json`                                                                                             | Claude Code                          |
| Gates                            | `eslint.config.mjs`, `tsconfig*.json`, `.dependency-cruiser.cjs`, `.husky/`, `.github/workflows/ci.yml` | everyone                             |

## The agents

| Agent              | Ask it to                                                       | Can edit |
| ------------------ | --------------------------------------------------------------- | -------- |
| `architect`        | design a feature: flow, contract, data model, decisions         | no       |
| `backend-api`      | build Express code and its tests                                | yes      |
| `data-mongodb`     | model collections, write repositories, indexes, migrations      | yes      |
| `angular-frontend` | build Angular pages, forms and their tests                      | yes      |
| `assistant-python` | work on the LangChain chatbot                                   | yes      |
| `qa`               | plan tests from requirements; audit what the tests really cover | no       |
| `devops-sre`       | fix the environment, pipeline, Docker, dependencies             | yes      |
| `code-reviewer`    | review a branch against the standard before a pull request      | no       |

## The skills

| Skill               | When                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| `new-feature`       | starting any use case: the full workflow from requirement to pull request |
| `new-api-module`    | adding a backend resource                                                 |
| `new-web-feature`   | adding a screen                                                           |
| `mongo-model`       | before creating or changing a collection                                  |
| `verify`            | before saying something works                                             |
| `request-exception` | you have decided to break a rule anyway                                   |
| `adr`               | recording a decision                                                      |
| `threat-model`      | files, money, roles, integrations, authentication                         |
| `assistant-tool`    | giving the chatbot a capability                                           |

In Claude Code type `/new-feature` (or just describe the task; the skill loads when relevant).

## What gets blocked, and what to do

| You will see                                           | Why                                                                                                      | Do this                                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| "Blocked: this edit … breaks the engineering standard" | the code contains a banned pattern (`any`, a framework import in the domain, `req.body` into a model, …) | let the agent write the compliant version; the message says what that is                               |
| "Blocked write to .env"                                | agents never touch secrets                                                                               | edit `.env` yourself; the agent adds the variable _name_ to `.env.example`                             |
| A permission prompt on a guard-rail file               | lint config, hooks, CI, the standard and exceptions always ask you                                       | read the change; approve only if you understand why it is needed                                       |
| "Blocked command" on `git commit`                      | you are on `main`, or `--no-verify` was used                                                             | `git switch -c feat/<name>`                                                                            |
| A prompt about a new dependency                        | each one needs a reason                                                                                  | ask what it is for and whether existing code can do it                                                 |
| The agent keeps working after you expected it to stop  | the quick gates fail and the Stop hook will not let it finish                                            | let it fix the failure, or ask it to stop and report                                                   |
| The agent argues with your request                     | the pushback protocol                                                                                    | read the explanation; it is usually right. If you still want it, say so and it will draft an exception |

## Exceptions: the only way past a rule

1. The agent explains the rule and offers the compliant way.
2. If you still want to deviate, it drafts `docs/exceptions/EXC-NNNN-….md` with `Status: proposed`.
3. **You** read it and, if you agree, change the line to `Status: accepted`. Nobody else can.
4. The deviating line cites the id, for example `// eslint-disable-next-line no-console -- EXC-0007 …`.

Every exception has a scope and an expiry. Some rules cannot be waived at all.

## Which model for which job

The gates do not care which model wrote the code, which is what makes cheaper models usable.

| Task                                                                                              | Use                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Design, data modelling, the scheduling optimiser, threat models, code review                      | the strongest model you have (Claude)             |
| A new module or screen that copies an existing pattern                                            | a mid-tier model, with the relevant skill         |
| Small, fully specified edits: rename, add a field through all layers, write tests for given cases | the free OpenCode models (Big Pickle, MiMo Flash) |

With a weaker model: give it one small task, name the files, name the skill to follow, and run
`npm run verify:quick` yourself afterwards. Expect it to be blocked more often; that is the
system working. Have a stronger model review before the pull request.

## OpenCode

Start `opencode` in the repository root. It reads `AGENTS.md`, the rules listed in
`opencode.json`, the agents in `.opencode/agents/` (mention them with `@backend-api`), and the
skills in `.claude/skills/`. The plugin applies the same content and command rules as the Claude
hooks. Two differences from Claude Code:

- OpenCode has no equivalent of the Stop hook. **Run `npm run verify:quick` yourself** before
  accepting its work. The git hooks still run on commit and push.
- A plugin cannot ask a question, so "needs approval" cases are OpenCode permission prompts
  defined in `opencode.json`.

After editing an agent in `.claude/agents/`, run `npm run ai:sync`.

## Maintaining the environment

- Rules live in `scripts/ai/guards/*.mjs`, each with the section it enforces and a message that
  explains itself. Add a test case in `guards.test.mjs` with every rule you add or change, then
  `npm run test:guards`.
- A false positive is a bug in a rule: fix the pattern and add the case to the tests. Do not
  work around it once.
- Keep `AGENTS.md` short. Detail belongs in a path-scoped rule or a skill, which load only when
  relevant.
- When an agent makes the same mistake twice, add a rule (a guard if it is detectable, otherwise
  an instruction).

## Limits, stated honestly

- The guards are pattern checks. They catch honest mistakes; they do not stop someone determined
  to evade them. Lint, types, tests and CI are the real control.
- The prompt check that detects "skip the tests"-style requests is a heuristic in English and
  Spanish. It will miss some phrasings and occasionally fire on an innocent one.
- Nothing here verifies that a design is _good_, or that a business rule is the right one. That
  is what the `architect`, `qa` and `code-reviewer` agents and your own review are for.
- Branch protection on GitHub (required CI, no direct pushes to `main`) must be switched on in
  the repository settings; the local hooks cannot enforce it for other clones.
