// Runs the quality gates in order and prints one summary (standard §10.4).
//   npm run verify:quick   fast gates: what the agent Stop hook and pre-push run
//   npm run verify         every gate: run before opening a pull request
// Every gate runs even if an earlier one fails, so one run shows everything that is wrong.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');
const hasPython = existsSync(join(root, 'apps', 'assistant', '.venv'));

/** @type {{ name: string, script: string, full?: boolean, skip?: string | false }[]} */
const gates = [
  { name: 'Guard rules', script: 'guard:scan' },
  { name: 'Guard self-tests', script: 'test:guards' },
  { name: 'Tests: MCP import', script: 'test:mcp' },
  { name: 'Agent files in sync', script: 'ai:check' },
  { name: 'Format', script: 'format:check' },
  { name: 'Lint', script: 'lint' },
  { name: 'Types: API', script: 'typecheck:api' },
  { name: 'Types: web', script: 'typecheck:web', full: true },
  { name: 'Types: tooling', script: 'typecheck:tools', full: true },
  { name: 'Architecture', script: 'arch' },
  { name: 'API contract fresh', script: 'contract:check' },
  { name: 'Tests: API', script: 'test:api' },
  { name: 'Tests: API integration', script: 'test:int', full: true },
  { name: 'Tests: web', script: 'test:web', full: true },
  { name: 'Build', script: 'build', full: true },
  { name: 'Python lint', script: 'py:lint', skip: !hasPython && 'no .venv' },
  { name: 'Python types', script: 'py:type', skip: !hasPython && 'no .venv' },
  { name: 'Python tests', script: 'py:test', skip: !hasPython && 'no .venv' },
  { name: 'Dependency audit', script: 'audit', full: true },
  { name: 'Secret scan', script: 'secrets', full: true },
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const results = [];

for (const gate of gates) {
  if (quick && gate.full) continue;
  if (gate.skip) {
    results.push({ ...gate, status: 'SKIP', seconds: 0, note: gate.skip });
    continue;
  }
  process.stdout.write(`\n=== ${gate.name} (npm run ${gate.script}) ===\n`);
  const started = Date.now();
  const run = spawnSync(npm, ['run', '--silent', gate.script], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  results.push({
    ...gate,
    status: run.status === 0 ? 'PASS' : 'FAIL',
    seconds: Math.round((Date.now() - started) / 1000),
  });
}

const failed = results.filter((result) => result.status === 'FAIL');
const skipped = results.filter((result) => result.status === 'SKIP');

process.stdout.write(`\n=== Summary (${quick ? 'quick' : 'full'}) ===\n`);
for (const result of results) {
  const note = result.note ? ` (${result.note})` : '';
  process.stdout.write(
    `${result.status.padEnd(4)} ${result.name.padEnd(26)} ${String(result.seconds).padStart(4)}s  npm run ${result.script}${note}\n`,
  );
}

if (failed.length > 0) {
  process.stdout.write(
    `\n${failed.length} gate(s) FAILED: ${failed.map((r) => r.name).join(', ')}.\n`,
  );
  process.exit(1);
}
if (skipped.length > 0) {
  // A skipped gate is not a passed gate: say so, so nobody reports "all green" by mistake.
  process.stdout.write(
    `\nPassed, but ${skipped.length} gate(s) were SKIPPED and are NOT verified: ${skipped.map((r) => r.name).join(', ')}. Run \`npm run bootstrap\`.\n`,
  );
  process.exit(quick ? 0 : 1);
}
process.stdout.write(
  quick
    ? '\nQuick gates passed. Run `npm run verify` before opening a pull request.\n'
    : '\nAll gates passed.\n',
);
