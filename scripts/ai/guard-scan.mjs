// Tool-agnostic gate: applies the guard content rules to every tracked source file.
// It catches violations no matter who wrote them: Claude, OpenCode, another tool, or a person.
//   npm run guard:scan            all tracked and untracked (not ignored) files
//   node scripts/ai/guard-scan.mjs --staged   only files staged for commit
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  checkContent,
  formatViolations,
  loadAcceptedExceptions,
} from './guards/index.mjs';

const SCANNED =
  /\.(ts|mts|cts|js|mjs|cjs|html|py|json|ya?ml|md|toml|env|example|sh|ps1)$|(^|\/)\.env/;
const SKIPPED = /(^|\/)(package-lock\.json|uv\.lock)$|^packages\/api-contracts\/generated\//;
const MAX_BYTES = 1_000_000;

const git = (args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const staged = process.argv.includes('--staged');
const files = staged
  ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
  : git(['ls-files', '--cached', '--others', '--exclude-standard']);

const accepted = loadAcceptedExceptions();
let total = 0;

for (const path of files) {
  if (!SCANNED.test(path) || SKIPPED.test(path)) continue;
  const absolute = join(REPO_ROOT, path);
  if (!existsSync(absolute) || statSync(absolute).size > MAX_BYTES) continue;

  const violations = checkContent({ path, content: readFileSync(absolute, 'utf8'), accepted });
  if (violations.length === 0) continue;
  total += violations.length;
  process.stderr.write(`\n${path}\n${formatViolations(violations)}\n`);
}

if (total > 0) {
  process.stderr.write(
    `\n${total} guard violation(s). Fix the code; a rule is lifted only by an accepted record in docs/exceptions/.\n`,
  );
  process.exit(1);
}
process.stdout.write(`Guard scan passed (${files.length} files considered).\n`);
