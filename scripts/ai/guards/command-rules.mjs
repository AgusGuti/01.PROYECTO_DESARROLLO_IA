// Command rules: shell commands an agent must not run, or must get approval for.
import { PROTECTED_PATH_HINT } from './path-rules.mjs';

const PROTECTED_BRANCH = /^(main|master)$/;

/**
 * @typedef {object} CommandRule
 * @property {string} id
 * @property {'deny' | 'ask'} decision
 * @property {RegExp} pattern
 * @property {string} message
 * @property {(ctx: { command: string, branch: string | null, hasCommits: boolean }) => boolean} [when]
 */

/** @type {CommandRule[]} */
export const COMMAND_RULES = [
  {
    id: 'no-skipping-git-hooks',
    decision: 'deny',
    pattern:
      /--no-verify\b|\bHUSKY=0\b|\bgit\b[^|;&]*\bcommit\b[^|;&]*\s-[a-zA-Z]*n[a-zA-Z]*\b|core\.hooksPath/,
    message:
      'Git hooks are the quality gates (§10.4). If a gate fails, fix the cause; if the gate is wrong, change it through an approved exception.',
  },
  {
    id: 'no-commit-on-main',
    decision: 'deny',
    pattern: /\bgit\b[^|;&]*\b(commit|merge|cherry-pick|revert)\b/,
    when: ({ branch, hasCommits }) =>
      hasCommits && branch !== null && PROTECTED_BRANCH.test(branch),
    message:
      'Changes reach main only through a pull request with green CI (§12.1). Create a branch first: `git switch -c feat/<short-name>`.',
  },
  {
    id: 'no-push-to-main',
    decision: 'deny',
    pattern: /\bgit\b[^|;&]*\bpush\b[^|;&]*(\s|:)(main|master)(\s|$)/,
    message: 'Do not push to main directly. Push the feature branch and open a pull request.',
  },
  {
    id: 'no-force-push',
    decision: 'deny',
    pattern: /\bgit\b[^|;&]*\bpush\b[^|;&]*(\s--force\b(?!-with-lease)|\s-[a-zA-Z]*f[a-zA-Z]*\b)/,
    message:
      'Force-pushing rewrites shared history. If a rebase really requires it on your own branch, use `--force-with-lease`.',
  },
  {
    id: 'no-forced-installs',
    decision: 'deny',
    pattern: /\bnpm\b[^|;&]*(--force\b|--legacy-peer-deps\b|\s-f\b)/,
    message:
      'Forcing an install hides a real version conflict that will break later (§8.4). Resolve the conflict by choosing compatible versions.',
  },
  {
    id: 'no-global-installs',
    decision: 'deny',
    pattern:
      /\bnpm\b[^|;&]*\s(-g|--global)\b|\b(winget|choco|scoop)\s+(install|upgrade)\b|\bpip3?\s+install\b[^|;&]*--user\b|\bpipx\s+install\b|\buv\s+tool\s+install\b/,
    message:
      'The project is self-contained: tools live in node_modules, apps/assistant/.venv, .tools/ or Docker. Add it as a project dependency or to scripts/bootstrap.mjs.',
  },
  {
    id: 'no-pip-outside-venv',
    decision: 'deny',
    pattern: /(^|[;&|]\s*)(python\s+-m\s+)?pip3?\s+install\b/,
    message:
      'Python dependencies are declared in apps/assistant/pyproject.toml and installed into its .venv with `npm run py -- uv add <pkg>`.',
  },
  {
    id: 'no-audit-fix-force',
    decision: 'deny',
    pattern: /\bnpm\s+audit\s+fix\b[^|;&]*--force/,
    message:
      '`npm audit fix --force` applies breaking upgrades blindly. Upgrade the named package deliberately.',
  },
  {
    id: 'no-disabling-type-or-lint-gates',
    decision: 'deny',
    pattern:
      /--noEmitOnError\s+false|--strict\s+false|--noImplicitAny\s+false|\beslint\b[^|;&]*--no-eslintrc|--passWithNoTests\b|\bSKIP_(TESTS|LINT|VERIFY)\b/,
    message:
      'This switches a quality gate off for one run. Gates are fixed, not bypassed (§10.3, §10.4).',
  },
  {
    id: 'destructive-git',
    decision: 'ask',
    pattern:
      /\bgit\b[^|;&]*\b(reset\s+--hard|clean\s+-[a-zA-Z]*f|checkout\s+--\s|restore\s+\.|branch\s+-D|stash\s+(drop|clear))/,
    message: 'This discards work that cannot be recovered. Confirm with Agustín.',
  },
  {
    id: 'destructive-data',
    decision: 'ask',
    pattern:
      /\bdocker\b[^|;&]*\b(compose\b[^|;&]*\bdown\b[^|;&]*(\s-v\b|--volumes)|volume\s+(rm|prune)|system\s+prune)|dropDatabase|\.drop\s*\(|deleteMany\s*\(\s*\{\s*\}\s*\)|\bmongorestore\b[^|;&]*--drop/,
    message:
      'This deletes database data (§4.6: no destructive operation without a strategy and approval).',
  },
  {
    id: 'destructive-files',
    decision: 'ask',
    pattern:
      /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\b|\bRemove-Item\b[^|;&]*-Recurse|\brmdir\s+\/s|\bdel\s+\/s/i,
    message: 'Recursive delete. Confirm the target with Agustín.',
  },
  {
    id: 'new-dependency',
    decision: 'ask',
    pattern:
      /\bnpm\s+(i|install|add)\b(\s+-\S+)*\s+[^\s\-|;&]|\bnpx\s+(-y\s+|--yes\s+)?ng\s+add\b|\buv\s+add\b|\bpoetry\s+add\b/,
    message:
      'A new dependency needs a demonstrable need (§0.3) and a check of maintenance, licence and install scripts (§8.4). State why existing code or the platform cannot do this.',
  },
  {
    id: 'protected-path-via-shell',
    decision: 'ask',
    pattern:
      /(>{1,2}|\bsed\s+-i|\btee\b|\bmv\b|\bcp\b|\brm\b|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item)/,
    when: ({ command }) => PROTECTED_PATH_HINT.test(command),
    message: 'This command changes a guard-rail or secret file from the shell. It needs approval.',
  },
];

/**
 * @param {object} ctx
 * @param {string} ctx.command
 * @param {string | null} [ctx.branch] current git branch, null if unknown
 * @param {boolean} [ctx.hasCommits] false in a brand-new repository
 * @returns {{ decision: 'allow' | 'ask' | 'deny', violations: { rule: string, message: string }[] }}
 */
export function checkCommand({ command, branch = null, hasCommits = true }) {
  const hits = COMMAND_RULES.filter(
    (rule) => rule.pattern.test(command) && (rule.when?.({ command, branch, hasCommits }) ?? true),
  );
  const denied = hits.filter((rule) => rule.decision === 'deny');
  const chosen = denied.length > 0 ? denied : hits;
  return {
    decision: denied.length > 0 ? 'deny' : hits.length > 0 ? 'ask' : 'allow',
    violations: chosen.map((rule) => ({ rule: rule.id, message: rule.message })),
  };
}
