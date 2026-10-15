// Usage: npm run db:seed:filaments (from the repository root, with the API running: npm run dev).
// Loads five sample filament spools through the public API, so every value goes through the same
// validation as a user's request. Safe to repeat: a spool with the same brand, material and
// colour that already exists is skipped. Development only; refuses to run in production.
import { loadConfigFromEnvironment } from '../src/config/env.js';
import { createLogger } from '../src/shared/logging/logger.js';

const config = loadConfigFromEnvironment();
const logger = createLogger(config);

const DAY_MS = 24 * 60 * 60 * 1000;

// Costs are plausible ARS estimates in centavos (1_950_000 = $19.500,00), not vendor prices.
// `daysAgo` keeps every purchase date in the past, whatever day this runs.
const FILAMENTS = [
  {
    brand: 'Grilon3',
    material: 'PLA',
    colorName: 'Negro',
    initialGrams: 1000,
    purchaseCostMinor: 1_950_000,
    daysAgo: 45,
  },
  {
    brand: 'Printalot',
    material: 'PETG',
    colorName: 'Azul',
    initialGrams: 1000,
    purchaseCostMinor: 2_400_000,
    daysAgo: 30,
  },
  {
    brand: 'eSun',
    material: 'PLA',
    colorName: 'Blanco',
    initialGrams: 1000,
    availableGrams: 640,
    purchaseCostMinor: 2_100_000,
    daysAgo: 60,
  },
  {
    brand: 'Sunlu',
    material: 'TPU',
    colorName: 'Rojo',
    initialGrams: 500,
    availableGrams: 410,
    purchaseCostMinor: 3_800_000,
    daysAgo: 12,
  },
  {
    // A carbon-fibre nylon: it needs a hardened-steel nozzle (a printer concern, not linked here).
    brand: 'Polymaker',
    material: 'PA_CF',
    colorName: 'Negro',
    initialGrams: 500,
    purchaseCostMinor: 6_500_000,
    daysAgo: 3,
  },
];

interface ListedFilament {
  brand: string;
  material: string;
  colorName: string;
}

const keyOf = (f: ListedFilament): string => `${f.brand}|${f.material}|${f.colorName}`;

function utcDay(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

function isListedFilament(value: unknown): value is ListedFilament {
  if (typeof value !== 'object' || value === null) return false;
  const { brand, material, colorName } = value as Record<string, unknown>;
  return typeof brand === 'string' && typeof material === 'string' && typeof colorName === 'string';
}

// shortcut: only the first 100 live spools are compared, so with more than 100 an already loaded
// sample could be created again; follow the pages if the seed is ever run on a large inventory.
async function existingKeys(url: string): Promise<Set<string>> {
  const response = await fetch(`${url}?pageSize=100`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`listing filaments answered ${String(response.status)}`);
  const body: unknown = await response.json();
  const items =
    typeof body === 'object' && body !== null && 'items' in body && Array.isArray(body.items)
      ? (body.items as unknown[])
      : [];
  return new Set(items.filter(isListedFilament).map(keyOf));
}

async function seed(): Promise<void> {
  if (config.env === 'production') {
    logger.fatal('refusing to load sample filaments in production');
    process.exitCode = 1;
    return;
  }

  const url = `http://${config.host}:${String(config.port)}/api/v1/filaments`;
  const existing = await existingKeys(url);
  for (const { daysAgo, ...spool } of FILAMENTS) {
    const label = { brand: spool.brand, material: spool.material, colorName: spool.colorName };
    if (existing.has(keyOf(spool))) {
      logger.info(label, 'filament skipped: it already exists');
      continue;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...spool, purchaseDate: utcDay(daysAgo) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 201) {
      logger.info(label, 'filament created');
    } else {
      logger.error({ ...label, status: response.status }, 'filament was not created');
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
