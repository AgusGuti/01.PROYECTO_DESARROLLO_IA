// SessionStart: give the agent the project state it would otherwise have to discover.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, gitState, loadAcceptedExceptions } from '../../scripts/ai/guards/index.mjs';
import { readInput, reply, run, runHook } from './lib.mjs';

function currentRoadmapItem() {
  try {
    const roadmap = readFileSync(join(REPO_ROOT, 'docs', 'product', 'roadmap.md'), 'utf8');
    return /^\*\*Current:\*\*\s*(.+)$/m.exec(roadmap)?.[1] ?? null;
  } catch {
    return null;
  }
}

function pendingExceptions(accepted) {
  try {
    return readdirSync(join(REPO_ROOT, 'docs', 'exceptions'))
      .map((file) => /^(EXC-\d{4})/.exec(file)?.[1])
      .filter((id) => id && !accepted.has(id));
  } catch {
    return [];
  }
}

runHook('session-start', async () => {
  await readInput();
  const { branch, hasCommits } = gitState();
  const accepted = loadAcceptedExceptions();
  const pending = pendingExceptions(accepted);
  const lines = [`Branch: ${branch ?? 'unknown'}.`];

  if (hasCommits && (branch === 'main' || branch === 'master')) {
    lines.push(
      'You are on main. Create a feature branch before changing anything: `git switch -c feat/<name>`.',
    );
  }
  const roadmapItem = currentRoadmapItem();
  if (roadmapItem) lines.push(`Roadmap, current item: ${roadmapItem}`);

  lines.push(
    accepted.size > 0
      ? `Accepted exceptions to the standard: ${[...accepted].sort().join(', ')} (see docs/exceptions/).`
      : 'No accepted exceptions to the standard.',
  );
  if (pending.length > 0) {
    lines.push(`Exception records not accepted (they waive nothing): ${pending.join(', ')}.`);
  }

  if (!existsSync(join(REPO_ROOT, 'node_modules'))) {
    lines.push('Dependencies are not installed. Run `npm run bootstrap` before anything else.');
  }
  if (!existsSync(join(REPO_ROOT, '.env'))) {
    lines.push(
      '.env is missing. Agustín must copy .env.example to .env (agents never write .env).',
    );
  }

  const mongo = run('docker', ['compose', 'ps', '--status', 'running', '--services'], {
    timeoutMs: 8_000,
  });
  if (mongo.missing || mongo.timedOut || !mongo.ok) {
    lines.push(
      'Docker is not reachable, so MongoDB is down. Start Docker Desktop, then `npm run db:up`.',
    );
  } else if (!mongo.output.split(/\r?\n/).includes('mongo')) {
    lines.push(
      'MongoDB is not running. Start it with `npm run db:up` before running the API or integration tests.',
    );
  }

  lines.push(
    'Follow AGENTS.md: inspect before changing, push back on deviations, explain new concepts briefly, and never claim a check passed without running it.',
  );

  reply({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  });
});
