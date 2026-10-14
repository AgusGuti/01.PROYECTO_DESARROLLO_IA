// Usage: tsx scripts/generate-openapi.ts <output-file>
// Called by scripts/contract.mjs at the repository root; prefer `npm run contract`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stringify } from 'yaml';
import { buildOpenApiDocument } from '../src/openapi/document.js';

const target = process.argv[2];
if (target === undefined) {
  process.stderr.write('Usage: tsx scripts/generate-openapi.ts <output-file>\n');
  process.exitCode = 1;
} else {
  const outputPath = resolve(target);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, stringify(buildOpenApiDocument(), { lineWidth: 100 }), 'utf8');
}
