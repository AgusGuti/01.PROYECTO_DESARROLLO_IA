// Path rules: which files an agent may write, and which need a human decision.

/** Never written by an agent. */
const DENY = [
  {
    pattern: /(^|\/)\.env(\.(?!example$)[^/]*)?$/,
    message:
      'Environment files hold secrets and are never written by an agent (§6.5). Add the variable name to .env.example and to the config schema; Agustín sets the real value in .env himself.',
  },
  {
    pattern: /(^|\/)(node_modules|dist|\.angular|\.venv|\.tools)\//,
    message: 'This is installed or generated output. Change the source or the dependency instead.',
  },
  {
    pattern: /^packages\/api-contracts\/(openapi\.yaml|generated\/)/,
    message:
      'The API contract is generated from the Zod schemas. Edit the schemas in apps/api and run `npm run contract`.',
  },
  {
    pattern: /^\.opencode\/agents\//,
    message: 'OpenCode agents are generated. Edit .claude/agents/*.md and run `npm run ai:sync`.',
  },
  {
    pattern: /(^|\/)(package-lock\.json|uv\.lock)$/,
    message: 'Lockfiles are written by the package manager, never by hand (§8.4).',
  },
];

/** Writable only after Agustín approves the specific change. */
const ASK = [
  {
    pattern: /^docs\/exceptions\//,
    message:
      'Exception records are accepted by Agustín, not by an agent (§0.2). He must approve this write.',
  },
  {
    pattern: /^docs\/standards\//,
    message: 'The engineering standard is the source of the rules. Changing it needs approval.',
  },
  {
    pattern:
      /^(\.claude\/|\.opencode\/|opencode\.jsonc?$|\.mcp\.json$|scripts\/ai\/|scripts\/git\/|AGENTS\.md$|CLAUDE\.md$)/,
    message: 'This file is part of the guard rails. Weakening it needs approval.',
  },
  {
    pattern:
      /(^|\/)(eslint\.config\.[cm]?js|tsconfig[^/]*\.json|\.dependency-cruiser\.c?js|vitest\.config\.[cm]?ts|commitlint\.config\.[cm]?js|lint-staged\.config\.[cm]?js|pyproject\.toml|\.gitleaks\.toml|\.npmrc)$/,
    message:
      'This file configures a quality gate. Relaxing a gate needs approval and an EXC record.',
  },
  {
    pattern: /^(\.husky\/|\.github\/)/,
    message: 'Git hooks and CI pipelines are quality gates. Changing them needs approval.',
  },
];

/**
 * @param {string} path repo-relative path with forward slashes
 * @returns {{ decision: 'allow' | 'ask' | 'deny', message?: string }}
 */
export function checkPath(path) {
  for (const rule of DENY) {
    if (rule.pattern.test(path)) return { decision: 'deny', message: rule.message };
  }
  for (const rule of ASK) {
    if (rule.pattern.test(path)) return { decision: 'ask', message: rule.message };
  }
  return { decision: 'allow' };
}

/** Paths a shell command must not rewrite without approval (used by command rules). */
export const PROTECTED_PATH_HINT =
  /(\.claude[\\/]|\.opencode[\\/]|\.husky[\\/]|\.github[\\/]|docs[\\/](exceptions|standards)[\\/]|scripts[\\/](ai|git)[\\/]|eslint\.config|tsconfig[\w.]*\.json|\.dependency-cruiser|\.env(?!\.example))/;
