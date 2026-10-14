// Git-hook half of "main changes only through pull requests" (standard §12.1).
// Applies to every tool and to manual git, unlike the agent guards.
//   protect-main.mjs commit   run by .husky/pre-commit
//   protect-main.mjs push     run by .husky/pre-push (git passes the pushed refs on stdin)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROTECTED = new Set(['main', 'master']);
const NO_COMMIT = /^0+$/;

const git = (...args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

function refuse(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

const mode = process.argv[2];

if (mode === 'commit') {
  const branch = git('symbolic-ref', '--short', 'HEAD');
  const hasCommits = git('rev-parse', '--verify', 'HEAD') !== null;
  // The very first commit of a new repository has to land somewhere; after that, never on main.
  if (branch !== null && PROTECTED.has(branch) && hasCommits) {
    refuse(
      `Commits on "${branch}" are blocked. Work on a branch and merge through a pull request:\n` +
        '  git switch -c feat/<short-name>',
    );
  }
} else if (mode === 'push') {
  const lines = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const [, localSha, remoteRef, remoteSha] = line.split(' ');
    const branch = remoteRef?.replace('refs/heads/', '');
    if (!branch || !PROTECTED.has(branch)) continue;

    // Allowed once: publishing the repository's root commit to a remote that has no main yet.
    const isFirstPublish =
      NO_COMMIT.test(remoteSha ?? '') && git('rev-list', '--count', localSha ?? '') === '1';
    if (!isFirstPublish) {
      refuse(
        `Pushing to "${branch}" is blocked. Push your branch and open a pull request instead:\n` +
          '  git push -u origin HEAD',
      );
    }
  }
} else {
  refuse('Usage: protect-main.mjs <commit|push>');
}
