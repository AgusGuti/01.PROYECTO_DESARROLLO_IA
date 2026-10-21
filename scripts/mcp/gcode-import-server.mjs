// Local MCP server (stdio): bulk-imports .gcode files from a folder as parts.
//   node scripts/mcp/gcode-import-server.mjs --root "D:\3D_Printings\00.GCODES"
// It never writes to the database itself: every file goes through the API (the same analysis and
// validation as the web form). Two tools: `scan_gcodes` is a dry run, `import_gcodes` applies it.
// EXC-0001: the API has no authentication, so this talks to the loopback address only.
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { decide, findGcodes, HEAD_CHARACTERS, toPart } from './gcode-import-core.mjs';

const API = 'http://127.0.0.1:3000/api/v1';
const TIMEOUT_MS = 15_000;
const MATERIALS = [
  'PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC', 'HIPS', 'PVA', 'PP', 'PLA_CF', 'PETG_CF',
  'PA_CF', 'PA_GF',
]; // prettier-ignore

const rootArg = process.argv[process.argv.indexOf('--root') + 1];
if (process.argv.indexOf('--root') === -1 || rootArg === undefined) {
  console.error('Usage: gcode-import-server.mjs --root <folder with .gcode files>');
  process.exit(1);
}
const root = resolve(rootArg);

const analysisSchema = z.object({
  estimatedPrintSeconds: z.number(),
  filamentGrams: z.number().nullable(),
  layerHeightUm: z.number().nullable(),
  dimensionsMm: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable(),
});
const partSchema = z.object({
  id: z.string(),
  version: z.number(),
  material: z.string(),
  dimensionsMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  estimatedWeightGrams: z.number(),
  estimatedPrintSeconds: z.number(),
  layerHeightUm: z.number(),
  source: z.object({ kind: z.string(), fileName: z.string().optional() }),
});
const listSchema = z.object({ items: z.array(partSchema), total: z.number() });

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(`${String(response.status)} ${problem.title ?? problem.detail ?? ''}`.trim());
  }
  return response.json();
}

/** Parts that came from a G-code file, by the relative path stored in `source.fileName`. */
async function importedParts() {
  const byFile = new Map();
  for (let page = 1; ; page++) {
    const list = listSchema.parse(await api('GET', `/parts?page=${String(page)}&pageSize=100`));
    for (const part of list.items) {
      if (part.source.kind === 'gcode' && part.source.fileName !== undefined) {
        byFile.set(part.source.fileName, part);
      }
    }
    if (page * 100 >= list.total) return byFile;
  }
}

async function readHead(relativePath) {
  const file = await open(resolve(root, relativePath), 'r');
  try {
    const { buffer, bytesRead } = await file.read(
      Buffer.alloc(HEAD_CHARACTERS),
      0,
      HEAD_CHARACTERS,
      0,
    );
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await file.close();
  }
}

/** Plans every file; with `apply` also carries the creates and updates out. */
async function run({ material, folder, apply }) {
  const [files, existing] = await Promise.all([findGcodes(root, folder), importedParts()]);
  const rows = [];
  for (const path of files) {
    try {
      const analysis = analysisSchema.parse(
        await api('POST', '/gcode-analyses', { head: await readHead(path), material }),
      );
      const part = toPart(path, analysis, material);
      if (part.skip !== undefined) {
        rows.push({ path, result: `skipped: ${part.skip}` });
        continue;
      }
      const decision = decide(part.fields, existing.get(path));
      if (apply && decision.action === 'create') await api('POST', '/parts', decision.body);
      if (apply && decision.action === 'update') {
        await api('PATCH', `/parts/${existing.get(path).id}`, decision.body);
      }
      rows.push({
        path,
        result:
          apply || decision.action === 'unchanged' ? done(decision.action, apply) : decision.action,
        grams: part.fields.estimatedWeightGrams,
        minutes: Math.round(part.fields.estimatedPrintSeconds / 60),
      });
    } catch (error) {
      rows.push({ path, result: `error: ${error instanceof Error ? error.message : 'unknown'}` });
    }
  }
  const counts = {};
  for (const row of rows) counts[row.result] = (counts[row.result] ?? 0) + 1;
  return { applied: apply, material, folder: folder || '(all)', counts, files: rows };
}

const done = (action, apply) =>
  action === 'unchanged' || !apply ? action : action === 'create' ? 'created' : 'updated';

const server = new McpServer({ name: 'gcode-import', version: '1.0.0' });
const shape = {
  material: z.enum(MATERIALS).describe('Material for every file in this batch.'),
  folder: z.string().max(200).optional().describe('Sub-folder of the root; default all of it.'),
};
const reply = (result) => ({ content: [{ type: 'text', text: JSON.stringify(result) }] });
const fail = (error) => ({
  isError: true,
  content: [{ type: 'text', text: error instanceof Error ? error.message : 'Unknown error' }],
});

server.registerTool(
  'scan_gcodes',
  {
    description:
      'Dry run: lists what importing would do (create / update / unchanged / skipped) per .gcode ' +
      'file. Changes nothing.',
    inputSchema: shape,
    annotations: { readOnlyHint: true },
  },
  async (input) => run({ ...input, apply: false }).then(reply, fail),
);

server.registerTool(
  'import_gcodes',
  {
    description:
      'Creates a part per new .gcode file and refreshes the analysed data of parts already ' +
      'imported from the same file. Run scan_gcodes first and show the user the result.',
    inputSchema: { ...shape, confirm: z.literal(true).describe('Must be true: the user agreed.') },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  async ({ confirm: _confirm, ...input }) => run({ ...input, apply: true }).then(reply, fail),
);

await server.connect(new StdioServerTransport());
