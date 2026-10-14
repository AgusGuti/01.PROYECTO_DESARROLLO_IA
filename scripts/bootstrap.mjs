// One command to make a fresh clone runnable: `npm run bootstrap`.
// Everything it installs stays inside this folder (node_modules, apps/assistant/.venv, .tools)
// or inside Docker. Safe to run again at any time.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, TOOLS, TOOLS_DIR } from './tools.mjs';

const isWindows = process.platform === 'win32';
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const UV_VERSION = '0.13.0';

const log = (message) => process.stdout.write(`${message}\n`);
const warn = (message) => process.stdout.write(`  ! ${message}\n`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: isWindows && /\.(cmd|bat)$/.test(command),
    ...options,
  });
  return result.status === 0;
}

function must(ok, message) {
  if (!ok) {
    process.stderr.write(`\nBootstrap failed: ${message}\n`);
    process.exit(1);
  }
}

function checkNode() {
  const required = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
  const [major, minor] = process.versions.node.split('.').map(Number);
  const [requiredMajor, requiredMinor] = required.split('.').map(Number);
  must(
    major === requiredMajor && minor >= requiredMinor,
    `Node ${required} or a newer ${requiredMajor}.x is required; found ${process.versions.node}.`,
  );
  log(`Node ${process.versions.node}`);
}

function installNodeDependencies() {
  log('\nInstalling Node dependencies from the lockfile (npm ci)...');
  must(run(isWindows ? 'npm.cmd' : 'npm', ['ci']), 'npm ci did not complete.');
}

function installPythonEnvironment() {
  log('\nPreparing the Python environment in apps/assistant/.venv...');
  const project = join(ROOT, 'apps', 'assistant');
  const bin = join(project, '.venv', isWindows ? 'Scripts' : 'bin');
  const python = join(bin, isWindows ? 'python.exe' : 'python');
  const uv = join(bin, isWindows ? 'uv.exe' : 'uv');

  if (!existsSync(python)) {
    const created =
      run(
        isWindows ? 'py' : 'python3.12',
        [...(isWindows ? ['-3.12'] : []), '-m', 'venv', '.venv'],
        {
          cwd: project,
        },
      ) || run('python', ['-m', 'venv', '.venv'], { cwd: project });
    must(created, 'could not create the virtual environment. Is Python 3.12 installed?');
  }
  if (!existsSync(uv)) {
    must(
      run(python, [
        '-m',
        'pip',
        'install',
        '--quiet',
        '--disable-pip-version-check',
        `uv==${UV_VERSION}`,
      ]),
      'could not install uv into the virtual environment.',
    );
  }
  must(
    run(uv, ['sync', '--frozen'], {
      cwd: project,
      env: { ...process.env, VIRTUAL_ENV: join(project, '.venv'), UV_PROJECT_ENVIRONMENT: '.venv' },
    }),
    'uv sync did not complete.',
  );
}

async function installTool(name) {
  const tool = TOOLS[name];
  const asset = tool.assets[`${process.platform}-${process.arch}`];
  if (!asset) {
    warn(`${name}: no pinned build for ${process.platform}-${process.arch}; skipped.`);
    return;
  }
  const marker = join(TOOLS_DIR, name, '.version');
  if (
    existsSync(tool.binary) &&
    existsSync(marker) &&
    readFileSync(marker, 'utf8') === tool.version
  ) {
    log(`${name} ${tool.version} already installed`);
    return;
  }

  log(`Downloading ${name} ${tool.version}...`);
  const response = await fetch(tool.url(tool.version, asset.file));
  must(response.ok, `${name}: download answered HTTP ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());

  // Never run a downloaded binary whose checksum does not match the pinned one (standard §8.4).
  const actual = createHash('sha256').update(archive).digest('hex');
  must(
    actual === asset.sha256,
    `${name}: checksum mismatch.\n  expected ${asset.sha256}\n  actual   ${actual}\nThe file was not installed.`,
  );

  const target = join(TOOLS_DIR, name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const archivePath = join(target, asset.file);
  writeFileSync(archivePath, archive);
  // Windows ships bsdtar as tar.exe, which also unpacks .zip archives.
  const tar = isWindows
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  must(run(tar, ['-xf', archivePath, '-C', target]), `${name}: could not unpack ${asset.file}.`);
  rmSync(archivePath);
  must(existsSync(tool.binary), `${name}: ${tool.binary} is missing after unpacking.`);
  writeFileSync(marker, tool.version);
  log(`${name} ${tool.version} installed in .tools/${name} (checksum verified)`);
}

function prepareEnvFile() {
  const target = join(ROOT, '.env');
  if (existsSync(target)) return;
  // .env.example holds local defaults only, no secrets, so copying it is safe.
  copyFileSync(join(ROOT, '.env.example'), target);
  log('\nCreated .env from .env.example (local defaults, no secrets).');
}

function startDatabase() {
  log('\nStarting MongoDB in Docker...');
  if (!run('docker', ['info'], { stdio: 'ignore' })) {
    warn('Docker is not running. Start Docker Desktop, then run: npm run db:up');
    return;
  }
  if (!run('docker', ['compose', 'up', '-d', '--wait', 'mongo'])) {
    warn('MongoDB did not start. Check: docker compose logs mongo');
  }
}

const steps = {
  node: installNodeDependencies,
  python: installPythonEnvironment,
  tools: async () => {
    log('\nInstalling project-local tools into .tools/...');
    mkdirSync(TOOLS_DIR, { recursive: true });
    for (const name of Object.keys(TOOLS)) await installTool(name);
  },
  env: prepareEnvFile,
  db: startDatabase,
};

checkNode();
if (only) {
  must(only in steps, `unknown step "${only}". Steps: ${Object.keys(steps).join(', ')}.`);
  await steps[only]();
} else {
  for (const step of Object.values(steps)) await step();
  log('\nBootstrap complete. Next: `npm run doctor`, then `npm run dev`.');
}
