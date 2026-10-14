// Secret detection with gitleaks (standard §10.4, §12.2).
//   npm run secrets                     working tree, then the whole git history
//   node scripts/secrets-scan.mjs --staged   only what is staged (used by the pre-commit hook)
import { spawnSync } from 'node:child_process';
import { ROOT, toolPath } from './tools.mjs';

const gitleaks = toolPath('gitleaks');
if (!gitleaks) {
  process.stderr.write(
    'gitleaks is not installed in .tools/. Run `npm run bootstrap` (or `node scripts/bootstrap.mjs --only=tools`).\n' +
      'The secret scan did NOT run.\n',
  );
  process.exit(1);
}

const common = ['--redact', '--no-banner', '--exit-code', '1'];
const scans = process.argv.includes('--staged')
  ? [['git', '--pre-commit', '--staged', ...common]]
  : [
      ['dir', '.', ...common],
      ['git', ...common],
    ];

for (const args of scans) {
  const result = spawnSync(gitleaks, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    process.stderr.write(
      '\nA possible secret was found. Remove it, rotate the credential if it was ever real, ' +
        'and keep secrets in .env only.\n',
    );
    process.exit(1);
  }
}
