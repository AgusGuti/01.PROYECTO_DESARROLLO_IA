# 0003. The standard is enforced in three layers

- **Status:** accepted
- **Date:** 2026-10-13

## Context

The developer asked for an environment that insists on good practices even when he tries to
deviate, because he is new to the stack. Instructions alone do not achieve that: a model can
ignore a prompt, weaker models do so often, and more than one AI tool will be used (Claude Code
and OpenCode with free models).

## Decision

Every mandatory rule that a machine can detect is enforced where no tool can skip it. The
AI-specific layers only give earlier feedback.

1. **Tool-agnostic gates (the authority).** ESLint, strict TypeScript, `dependency-cruiser`,
   tests, the guard scan, git hooks (husky) and CI. They apply equally to Claude, OpenCode,
   any other tool, and hand-written code. One command runs them all: `npm run verify`.
2. **Agent guards (early feedback).** Claude Code hooks (`.claude/hooks/`) and an OpenCode
   plugin (`.opencode/plugins/guard.js`) block a bad edit or command before it lands. Both call
   the same pure functions in `scripts/ai/guards/`, which have their own tests.
3. **Instructions (judgement).** `AGENTS.md`, path-scoped rules, role agents and skills cover
   what cannot be checked mechanically: design, modelling, threat analysis, and pushing back.

**Exceptions.** A blocked rule is lifted only by a record in `docs/exceptions/` whose status is
`accepted`. Writing to that folder, and to any guard-rail file, always asks the developer, so an
agent cannot approve its own exception. A suppression comment must cite an accepted record on
the same line. A few rules (`@ts-ignore`, `$where`, `eval`, disabling TLS verification, a MongoDB
driver in the assistant) cannot be waived at all.

## Alternatives considered

- **Instructions only:** cheap, and not enforcement.
- **Claude Code hooks only:** would not cover OpenCode or manual edits, and a hook can be missed
  if the session is started elsewhere.
- **No override at all:** safest, but a legitimate edge case would force editing the guards by
  hand, which teaches the wrong habit. A written, reviewed exception teaches the right one.
- **Warn instead of block:** the developer explicitly asked not to be allowed to talk his way
  past the rules.

## Consequences

- The guards are fast, line-based pattern checks. They produce some false positives and can be
  evaded by someone determined. That is acceptable: layer 1 is the authority, and the guards'
  job is to stop honest mistakes early.
- Friction is real: commits on `main` are refused, new dependencies ask for a reason, the agent
  cannot finish while the quick gates fail. This is the requested behaviour.
- The guard rails are themselves code: they need tests (`npm run test:guards`) and review, and
  changes to them prompt for approval.
- If a rule proves wrong in practice, change the rule deliberately (with an ADR or exception),
  not by working around it once.
