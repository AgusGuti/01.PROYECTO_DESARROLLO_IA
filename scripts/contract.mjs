// Generates the public API contract from the Zod schemas in apps/api:
//   packages/api-contracts/openapi.yaml          (reviewable OpenAPI document)
//   packages/api-contracts/generated/types.gen.ts (TypeScript types for the Angular app)
//
//   npm run contract         regenerate both files
//   npm run contract:check   fail if the committed files are stale (used by CI and verify)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = join(root, 'packages', 'api-contracts');
const check = process.argv.includes('--check');

function run(label, script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`${label} failed:\n${result.stdout}${result.stderr}\n`);
    process.exit(1);
  }
}

function generateInto(target) {
  const yamlPath = join(target, 'openapi.yaml');
  run(
    'OpenAPI generation',
    join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    ['scripts/generate-openapi.ts', yamlPath],
    join(root, 'apps', 'api'),
  );
  run(
    'Type generation',
    join(root, 'node_modules', '@hey-api', 'openapi-ts', 'bin', 'run.js'),
    [
      '--input',
      yamlPath,
      '--output',
      join(target, 'generated'),
      '--plugins',
      '@hey-api/typescript',
      '--silent',
    ],
    root,
  );
}

const normalise = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function listFiles(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

if (!check) {
  rmSync(join(contracts, 'generated'), { recursive: true, force: true });
  generateInto(contracts);
  process.stdout.write('Contract regenerated in packages/api-contracts.\n');
} else {
  // The scratch copy must live inside the repository: the type generator reads the nearest
  // tsconfig to decide how to write import paths, so a folder elsewhere gives different output.
  const scratch = join(root, 'node_modules', '.cache', 'print3d-contract-check');
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    generateInto(scratch);
    const tracked = [
      'openapi.yaml',
      ...listFiles(join(contracts, 'generated'), 'generated/'),
    ].sort();
    const fresh = ['openapi.yaml', ...listFiles(join(scratch, 'generated'), 'generated/')].sort();
    const stale =
      tracked.join('\n') !== fresh.join('\n')
        ? ['file list']
        : fresh.filter(
            (file) =>
              !existsSync(join(contracts, file)) ||
              normalise(join(contracts, file)) !== normalise(join(scratch, file)),
          );
    if (stale.length > 0) {
      process.stderr.write(
        `The API contract is stale (${stale.join(', ')}).\nThe Zod schemas changed. Run \`npm run contract\` and commit the result.\n`,
      );
      process.exit(1);
    }
    process.stdout.write('Contract is up to date.\n');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
