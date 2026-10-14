// Shared guard logic. Callers: .claude/hooks/*.mjs, .opencode/plugins/guard.js,
// scripts/ai/guard-scan.mjs (the tool-agnostic gate) and the guard test suite.
import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { REPO_ROOT } from './root.mjs';

export { checkContent, CONTENT_RULES, SECRET_RULES } from './content-rules.mjs';
export { checkCommand, COMMAND_RULES } from './command-rules.mjs';
export { checkPath } from './path-rules.mjs';
export { checkPrompt, PUSHBACK_PROTOCOL } from './prompt-rules.mjs';
export { loadAcceptedExceptions, citesAcceptedException } from './exceptions.mjs';

export { REPO_ROOT };

/**
 * @param {string} filePath absolute or relative path, any separator
 * @param {string} [root]
 * @returns {string | null} repo-relative path with forward slashes, or null if outside the repo
 */
export function toRepoPath(filePath, root = REPO_ROOT) {
  const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split('\\').join('/');
}

/** @returns {{ branch: string | null, hasCommits: boolean }} */
export function gitState(root = REPO_ROOT) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  let branch = null;
  let hasCommits = false;
  try {
    branch = git(['symbolic-ref', '--short', 'HEAD']);
  } catch {
    // detached HEAD or not a repository
  }
  try {
    git(['rev-parse', '--verify', 'HEAD']);
    hasCommits = true;
  } catch {
    // no commits yet
  }
  return { branch, hasCommits };
}

/** @param {{ rule: string, section?: string, line?: number, excerpt?: string, message: string }[]} violations */
export function formatViolations(violations) {
  return violations
    .map((v) => {
      const where = v.line ? ` (line ${String(v.line)}: \`${v.excerpt ?? ''}\`)` : '';
      const section = v.section ? ` [standard ${v.section}]` : '';
      return `- ${v.rule}${section}${where}\n  ${v.message}`;
    })
    .join('\n');
}
