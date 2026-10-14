// Stop: an agent may not finish while changed code fails the fast gates.
// Runs only when source files changed since the last green run.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../scripts/ai/guards/index.mjs';
import { pass, readInput, readState, reply, run, runHook, tail, writeState } from './lib.mjs';

const SOURCE = /^(apps|packages|scripts)\//;
const MODULE_CODE =
  /^apps\/api\/src\/modules\/([^/]+)\/[^/]+\.(service|domain|repository|controller|routes|mapper)\.ts$/;
const MODULE_TEST = /^apps\/api\/src\/modules\/([^/]+)\/.+\.spec\.ts$/;
const MAX_BLOCKS = 3;
const STATE_FILE = 'stop.json';

/** @returns {string[]} repo-relative paths that differ from HEAD, including untracked files */
function changedFiles() {
  const status = run('git', ['status', '--porcelain', '--untracked-files=all'], {
    timeoutMs: 15_000,
  });
  if (!status.ok) return [];
  return status.output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) =>
      (/^\s*\S{1,2}\s+(.*)$/.exec(line)?.[1] ?? '').split(' -> ').pop().replace(/^"|"$/g, ''),
    )
    .filter((path) => SOURCE.test(path));
}

/** Changes when the content of any changed file changes. */
function fingerprint(files) {
  const hash = createHash('sha1');
  for (const file of [...files].sort()) {
    const absolute = join(REPO_ROOT, file);
    const stamp = existsSync(absolute)
      ? `${statSync(absolute).mtimeMs}:${statSync(absolute).size}`
      : 'deleted';
    hash.update(`${file}:${stamp}\n`);
  }
  return hash.digest('hex');
}

function modulesWithoutTestChanges(files) {
  const changed = new Set();
  const tested = new Set();
  for (const file of files) {
    const test = MODULE_TEST.exec(file);
    if (test) tested.add(test[1]);
    else if (MODULE_CODE.test(file)) changed.add(MODULE_CODE.exec(file)[1]);
  }
  return [...changed].filter((name) => !tested.has(name));
}

runHook('stop', async () => {
  const input = await readInput();
  const files = changedFiles();
  if (files.length === 0 || !existsSync(join(REPO_ROOT, 'node_modules'))) pass();

  const state = readState(STATE_FILE, { green: null, blocks: 0 });
  const current = fingerprint(files);
  if (state.green === current) pass();

  const verify = run(process.execPath, ['scripts/verify.mjs', '--quick'], { timeoutMs: 240_000 });

  if (verify.ok) {
    const untested = modulesWithoutTestChanges(files);
    writeState(STATE_FILE, { green: current, blocks: 0 });
    if (untested.length > 0 && input.stop_hook_active !== true) {
      reply({
        decision: 'block',
        reason: `The fast gates pass, but these API modules changed with no test change: ${untested.join(', ')}. The standard requires tests for success, invalid input and failure paths (§10.2). Add or adjust the tests, or tell Agustín explicitly why this change needs none.`,
      });
    }
    pass();
  }

  const blocks = (state.blocks ?? 0) + 1;
  writeState(STATE_FILE, { green: null, blocks });
  if (blocks > MAX_BLOCKS) {
    reply({
      systemMessage:
        'NOT VERIFIED: the fast quality gates still fail after several attempts. The work is not done. Run `npm run verify:quick` to see the failures.',
    });
  }
  reply({
    decision: 'block',
    reason: `You changed code and the fast gates fail (attempt ${blocks} of ${MAX_BLOCKS}). Fix the cause; do not weaken a gate, skip a test or add a suppression. If you cannot fix it, stop and report exactly what fails and what you tried.\n\n${tail(verify.timedOut ? 'verify:quick timed out after 240 s.' : verify.output)}`,
  });
});
