// `npm run doctor`: checks that this machine can run the project, and says how to fix what cannot.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, TOOLS, toolPath } from './tools.mjs';

const isWindows = process.platform === 'win32';
const results = [];

function capture(command, args, timeout = 15_000) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** @param {'required' | 'optional'} level */
function check(level, name, ok, detail, fix) {
  results.push({ level, name, ok, detail, fix });
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// --- Host prerequisites: the only things that must be installed on the machine itself. ---
const requiredNode = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
const [major, minor] = process.versions.node.split('.').map(Number);
const [requiredMajor, requiredMinor] = requiredNode.split('.').map(Number);
check(
  'required',
  'Node.js',
  major === requiredMajor && minor >= requiredMinor,
  `found ${process.versions.node}, need ${requiredMajor}.x >= ${requiredNode}`,
  `Install Node ${requiredNode} (winget upgrade OpenJS.NodeJS.22).`,
);

const git = capture('git', ['--version']);
check('required', 'Git', git.ok, git.output, 'Install Git.');

const docker = capture('docker', ['info', '--format', '{{.ServerVersion}}']);
check(
  'required',
  'Docker',
  docker.ok,
  docker.ok ? `engine ${docker.output}` : 'the Docker engine is not running',
  'Start Docker Desktop.',
);

// --- Project-local installs: created by `npm run bootstrap`. ---
check(
  'required',
  'Node dependencies',
  existsSync(join(ROOT, 'node_modules', '.package-lock.json')),
  'node_modules',
  'npm run bootstrap',
);

const venv = join(ROOT, 'apps', 'assistant', '.venv', isWindows ? 'Scripts' : 'bin');
const python = capture(join(venv, isWindows ? 'python.exe' : 'python'), ['--version']);
check(
  'required',
  'Python environment',
  python.ok && python.output.includes('3.12'),
  python.ok ? `${python.output} in apps/assistant/.venv` : 'apps/assistant/.venv is missing',
  'npm run bootstrap (needs Python 3.12 on the machine)',
);

for (const name of Object.keys(TOOLS)) {
  check(
    name === 'gitleaks' ? 'required' : 'optional',
    name,
    toolPath(name) !== null,
    `${TOOLS[name].version} in .tools/${name}`,
    'node scripts/bootstrap.mjs --only=tools',
  );
}

check(
  'required',
  '.env file',
  existsSync(join(ROOT, '.env')),
  '.env',
  'Copy .env.example to .env.',
);

const hooksPath = capture('git', ['config', '--get', 'core.hooksPath']);
check(
  'required',
  'Git hooks',
  hooksPath.ok && hooksPath.output.includes('.husky'),
  hooksPath.output || 'core.hooksPath is not set',
  'npm run prepare',
);

// --- Running services. ---
if (docker.ok) {
  const mongo = capture('docker', [
    'compose',
    'ps',
    '--format',
    '{{.Service}} {{.Health}}',
    'mongo',
  ]);
  check(
    'required',
    'MongoDB container',
    mongo.output.includes('mongo healthy'),
    mongo.output || 'not running',
    'npm run db:up',
  );
}

const env = existsSync(join(ROOT, '.env.example'))
  ? Object.fromEntries(
      readFileSync(join(ROOT, '.env.example'), 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
  : {};
const ollamaUrl = env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const model = env.LLM_MODEL ?? 'qwen3:8b';
const tags = await reachable(`${ollamaUrl}/api/tags`);
check(
  'optional',
  'Ollama',
  tags !== null,
  tags ? `reachable at ${ollamaUrl}` : `not reachable at ${ollamaUrl}`,
  'Start Ollama (docker compose --profile ollama up -d, or the Ollama desktop app).',
);
if (tags) {
  const names = Array.isArray(tags.models) ? tags.models.map((entry) => entry.name) : [];
  check(
    'optional',
    `Model ${model}`,
    names.includes(model),
    names.includes(model) ? 'available' : `not pulled (have: ${names.join(', ') || 'none'})`,
    `ollama pull ${model}`,
  );
}

// --- Report. ---
let failed = 0;
for (const result of results) {
  const mark = result.ok ? 'OK  ' : result.level === 'required' ? 'FAIL' : 'WARN';
  if (!result.ok && result.level === 'required') failed += 1;
  process.stdout.write(`${mark}  ${result.name.padEnd(20)} ${result.detail}\n`);
  if (!result.ok) process.stdout.write(`      fix: ${result.fix}\n`);
}
process.stdout.write(
  failed > 0
    ? `\n${failed} required check(s) failed.\n`
    : '\nReady. WARN items only affect the chat assistant or pull-request tooling.\n',
);
process.exit(failed > 0 ? 1 : 0);
