// Usage: npm run db:seed:projects (from the repository root, with the API running: npm run dev).
// Loads three sample projects through the public API, so every value goes through the same
// validation as a user's request. It needs the sample parts: run `npm run db:seed:parts` first.
// Safe to repeat: a project with the same name that already exists is skipped. Development only;
// refuses to run in production.
import { loadConfigFromEnvironment } from '../src/config/env.js';
import { createLogger } from '../src/shared/logging/logger.js';

const config = loadConfigFromEnvironment();
const logger = createLogger(config);

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of today (UTC) plus some days, the form the API expects (ADR 0011). */
function inDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

interface SeedProject {
  name: string;
  priority: string;
  deadline?: string;
  /** Part names (from the sample parts) with their quantity. */
  lines: { part: string; quantity: number }[];
}

const PROJECTS: SeedProject[] = [
  {
    name: 'Soportes para el taller',
    priority: 'high',
    deadline: inDays(30),
    lines: [
      { part: 'Soporte de estante en L', quantity: 6 },
      { part: 'Soporte de celular', quantity: 2 },
    ],
  },
  {
    name: 'Set de calibración',
    priority: 'normal',
    lines: [
      { part: 'Cubo de calibración 20 mm', quantity: 3 },
      { part: 'Engranaje de 24 dientes', quantity: 1 },
    ],
  },
  {
    name: 'Florero para regalo',
    priority: 'urgent',
    deadline: inDays(7),
    lines: [{ part: 'Florero espiral', quantity: 1 }],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The `items` array of a list answer, or an empty list when the shape is not the expected one. */
function itemsOf(body: unknown): unknown[] {
  return isRecord(body) && Array.isArray(body['items']) ? body['items'] : [];
}

async function listItems(url: string): Promise<unknown[]> {
  const response = await fetch(`${url}?pageSize=100`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`listing ${url} answered ${String(response.status)}`);
  return itemsOf(await response.json());
}

// shortcut: only the first 100 live parts and projects are read, so with more than 100 a part
// could be missed or an already loaded sample created again; follow the pages if the seed is
// ever run on a large catalogue.
async function partIdsByName(url: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const item of await listItems(url)) {
    if (isRecord(item) && typeof item['id'] === 'string' && typeof item['name'] === 'string') {
      ids.set(item['name'], item['id']);
    }
  }
  return ids;
}

async function projectNames(url: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const item of await listItems(url)) {
    if (isRecord(item) && typeof item['name'] === 'string') names.add(item['name']);
  }
  return names;
}

async function seed(): Promise<void> {
  if (config.env === 'production') {
    logger.fatal('refusing to load sample projects in production');
    process.exitCode = 1;
    return;
  }

  const base = `http://${config.host}:${String(config.port)}/api/v1`;
  const partIds = await partIdsByName(`${base}/parts`);
  const existing = await projectNames(`${base}/projects`);

  for (const project of PROJECTS) {
    const label = { name: project.name };
    if (existing.has(project.name)) {
      logger.info(label, 'project skipped: it already exists');
      continue;
    }

    const items: { partId: string; quantity: number }[] = [];
    const missing: string[] = [];
    for (const line of project.lines) {
      const partId = partIds.get(line.part);
      if (partId === undefined) missing.push(line.part);
      else items.push({ partId, quantity: line.quantity });
    }
    if (missing.length > 0) {
      logger.warn(
        { ...label, missing },
        'project skipped: some sample parts are missing; run `npm run db:seed:parts` first',
      );
      continue;
    }

    const response = await fetch(`${base}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: project.name,
        priority: project.priority,
        ...(project.deadline === undefined ? {} : { deadline: project.deadline }),
        items,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 201) {
      logger.info(label, 'project created');
    } else {
      logger.error({ ...label, status: response.status }, 'project was not created');
      process.exitCode = 1;
    }
  }
}

try {
  await seed();
} catch (error) {
  logger.fatal({ err: error }, 'could not reach the API; is it running? Try: npm run dev');
  process.exitCode = 1;
}
