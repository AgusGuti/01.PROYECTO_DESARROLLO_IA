// PostToolUse (Write | Edit | MultiEdit): format the changed file, then lint it and re-check the
// whole file against the guards (the pre-edit hook only saw the fragment being written).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  checkContent,
  formatViolations,
  loadAcceptedExceptions,
  toRepoPath,
} from '../../scripts/ai/guards/index.mjs';
import { EXCEPTION_HINT, localBin, pass, readInput, reply, run, runHook, tail } from './lib.mjs';

const LINTABLE = /^(apps|packages|scripts|\.claude\/hooks)\/.*\.(ts|mts|js|mjs|html)$/;
const FORMATTABLE = /\.(ts|mts|js|mjs|cjs|html|scss|css|json|md|ya?ml)$/;
const PYTHON = /^apps\/assistant\/.*\.py$/;

runHook('post-edit', async () => {
  const input = await readInput();
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== 'string') pass();
  const path = toRepoPath(filePath);
  if (path === null || !existsSync(join(REPO_ROOT, path))) pass();

  const problems = [];

  const prettier = localBin('prettier', 'bin', 'prettier.cjs');
  if (prettier && FORMATTABLE.test(path)) {
    run(process.execPath, [prettier, '--write', '--log-level', 'warn', '--ignore-unknown', path], {
      timeoutMs: 20_000,
    });
  }

  const violations = checkContent({
    path,
    content: readFileSync(join(REPO_ROOT, path), 'utf8'),
    accepted: loadAcceptedExceptions(),
  });
  if (violations.length > 0) problems.push(`Guard rules:\n${formatViolations(violations)}`);

  const eslint = localBin('eslint', 'bin', 'eslint.js');
  if (eslint && LINTABLE.test(path)) {
    const lint = run(process.execPath, [eslint, '--max-warnings', '0', '--no-warn-ignored', path], {
      timeoutMs: 90_000,
    });
    if (!lint.ok && !lint.timedOut) problems.push(`ESLint:\n${tail(lint.output, 2500)}`);
  }

  if (PYTHON.test(path)) {
    const ruff = run(
      process.execPath,
      ['scripts/py.mjs', 'ruff', 'check', path.replace('apps/assistant/', '')],
      {
        timeoutMs: 30_000,
      },
    );
    if (!ruff.ok && !ruff.missing && !ruff.timedOut)
      problems.push(`Ruff:\n${tail(ruff.output, 2500)}`);
  }

  if (problems.length === 0) pass();
  reply({
    decision: 'block',
    reason: `${path} was written but does not pass the gates. Fix these now, before doing anything else:\n\n${problems.join('\n\n')}\n\n${EXCEPTION_HINT}`,
  });
});
