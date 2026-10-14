// Runs a tool from the assistant's virtual environment, so nothing Python is installed globally.
//   npm run py -- pytest -k chat
//   npm run py -- uv add <package>
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'apps', 'assistant');
const isWindows = process.platform === 'win32';
const binDir = join(project, '.venv', isWindows ? 'Scripts' : 'bin');

const [tool, ...args] = process.argv.slice(2);
if (!tool) {
  process.stderr.write('Usage: node scripts/py.mjs <tool> [args...]\n');
  process.exit(2);
}

const executable = join(binDir, isWindows ? `${tool}.exe` : tool);
if (!existsSync(executable)) {
  process.stderr.write(
    `"${tool}" is not installed in apps/assistant/.venv. Run \`npm run bootstrap\` first.\n`,
  );
  process.exit(127);
}

const result = spawnSync(executable, args, {
  cwd: project,
  stdio: 'inherit',
  // uv must manage this project's own .venv, never a global or parent environment.
  env: { ...process.env, VIRTUAL_ENV: join(project, '.venv'), UV_PROJECT_ENVIRONMENT: '.venv' },
});
process.exit(result.status ?? 1);
