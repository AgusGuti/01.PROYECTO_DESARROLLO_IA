// Runs the Playwright end-to-end tests with the browser stored inside the project
// (node_modules), not in a per-user cache, so the setup stays self-contained.
//   npm run test:e2e            (needs MongoDB: npm run db:up)
//   npm run test:e2e -- --ui    any extra arguments go to `playwright test`
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' };

const playwright = (args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', env }).status ?? 1;

// Does nothing when the pinned browser build is already present.
const install = playwright(['install', ...(process.env.CI ? ['--with-deps'] : []), 'chromium']);
if (install !== 0) process.exit(install);

process.exit(playwright(['test', ...process.argv.slice(2)]));
