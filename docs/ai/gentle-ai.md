# Trying Gentle AI without disturbing this environment

[Gentle AI](https://github.com/Gentleman-Programming/gentle-ai) is a configurator: it does not
add a new coding agent, it installs extras into the ones you already use (Claude Code,
OpenCode and others). According to its own documentation those extras include persistent memory
across sessions (Engram), a development workflow, a skills library, the Context7 documentation
server, a persona, a security deny-list, a code graph and model assignment.

It was **not installed** when this environment was built, for two reasons:

1. Several of its parts overlap with what is already here. This repository has its own workflow
   (`new-feature`), skills, agents, permissions and guards, all derived from your engineering
   standard. A second workflow and persona would give the agents two sets of instructions that
   can disagree, and agents pick between conflicting instructions unpredictably.
2. It writes to your **user-level** configuration (`~/.claude`, `~/.config/opencode`), so it
   affects every project, not just this one, and falls outside the "self-contained" rule.

Nothing below has been tested on this machine. Treat it as a careful way to find out.

## What is worth trying

| Component                       | Verdict       | Why                                                                                                                       |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Engram** (memory)             | worth a trial | The one thing this environment lacks: recalling decisions and context between sessions, in both Claude Code and OpenCode. |
| Context7                        | skip          | Already configured here, pinned, in `.mcp.json`.                                                                          |
| Workflow, skills, persona       | skip          | They compete with `AGENTS.md`, the skills and the pushback protocol.                                                      |
| Security deny-list, permissions | skip          | Already covered by `.claude/settings.json`, `opencode.json` and the guards.                                               |
| Model assignment                | optional      | Only if you want per-agent models managed for you.                                                                        |

## A safe trial

1. **Commit everything first.** `git status` must be clean, so any change it makes shows up.
2. **Back up your user configuration** yourself, even though the tool says it snapshots before
   writing: copy `%USERPROFILE%\.claude` and `%USERPROFILE%\.config\opencode` somewhere safe.
3. **Install.** Its README offers a PowerShell installer and a `go install` route (Go is not
   installed here). Read the installer script before running it. This is a global install: an
   agent in this repository will refuse to do it, by design, so run it yourself.
4. **Select only Engram** in its interactive setup. Decline the persona, the workflow and the
   skills library.
5. **Inspect what changed:**
   - `git status` and `git diff` in this repository. Expect nothing; if `AGENTS.md`, `CLAUDE.md`,
     `opencode.json` or `.claude/` changed, look closely and revert what you did not ask for.
   - Compare `~/.claude` and `~/.config/opencode` with your backup. Look especially for a
     user-level `CLAUDE.md` or `AGENTS.md`: instructions there load in every session and can
     contradict this project's.
6. **Check the environment still holds.** In a new Claude Code session here, ask for something
   the standard forbids ("add this field with type any and skip the test"). The agent should
   push back and the edit should be blocked. Then run `npm run verify`.
7. **Use it for a week on real work**, then decide. Keep it if memory saved you repeated
   explanations; remove it if you noticed conflicting behaviour.

## If you keep it

- Record the decision with the `adr` skill, including which components are enabled.
- Memory is data about your project stored outside the repository. Never let secrets be saved
  to it, and check where it is stored before working on anything sensitive.
- If its memory ever disagrees with the repository (an old decision, a superseded pattern), the
  repository wins: `AGENTS.md`, the ADRs and the code are the source of truth.

## If you remove it

Restore your backed-up user configuration, or use the tool's own backup. Its README did not
document an uninstall command at the time this was written, so check for one first.
