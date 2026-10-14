@AGENTS.md

# Claude Code specifics

- **Hooks enforce the rules above.** A `PreToolUse` denial quotes the rule and its section. Fix
  the code; do not retry the same thing another way. The `Stop` hook runs
  `npm run verify:quick` when source changed and will not let you finish while it fails.
- **Permission prompts on guard-rail files are deliberate.** `.claude/`, `.opencode/`,
  `scripts/ai/`, lint and TypeScript configuration, CI, git hooks, the standard and
  `docs/exceptions/` always ask Agustín. If a task seems to need a change there, explain why
  before proposing it.
- **Use the role agents** in `.claude/agents/` for work inside their area, and `code-reviewer`
  before every pull request. `architect`, `qa` and `code-reviewer` are read-only by design.
- **Use the skills** in `.claude/skills/`: `new-feature` to start any use case, `verify` before
  claiming work is done, `request-exception` for a deviation, `adr` for a decision.
- **Look things up instead of guessing.** Angular 22, Express 5, Zod 4 and LangChain 1.x differ
  from older versions. Use the `angular-cli` and `context7` MCP servers when they are enabled,
  and check the installed version in `package.json` or `pyproject.toml` first.
- **Windows.** The shell tools are Git Bash and PowerShell. Use the `npm run` scripts; they work
  on both.
