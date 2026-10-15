// Usage: npm run db:seed:parts (from the repository root, with the API running: npm run dev).
// Loads five sample parts through the public API, so every value goes through the same validation
// as a user's request. Safe to repeat: a part with the same name and material that already exists
// is skipped. Development only; refuses to run in production. It does not send `analyzedAt`: the
// server stamps it.
import { loadConfigFromEnvironment } from '../src/config/env.js';
import { createLogger } from '../src/shared/logging/logger.js';

const config = loadConfigFromEnvironment();
const logger = createLogger(config);

// Plausible estimates for sample data, not measured values.
const PARTS = [
  {
    name: 'Soporte de estante en L',
    material: 'PETG',
    dimensionsMm: { x: 60, y: 40, z: 25 },
    estimatedWeightGrams: 38,
    estimatedPrintSeconds: 5700,
    layerHeightUm: 200,
    source: { kind: 'manual' },
  },
  {
    name: 'Florero espiral',
    material: 'PLA',
    dimensionsMm: { x: 90, y: 90, z: 150 },
    estimatedWeightGrams: 62,
    estimatedPrintSeconds: 13_920,
    layerHeightUm: 200,
    source: { kind: 'gcode', fileName: 'florero-espiral.gcode', slicer: 'cura' },
  },
  {
    name: 'Soporte de celular',
    material: 'PLA',
    dimensionsMm: { x: 80, y: 70, z: 110 },
    estimatedWeightGrams: 45,
    estimatedPrintSeconds: 9600,
    layerHeightUm: 200,
    suggestedPrinterName: 'Creality Ender-3 Pro',
    source: { kind: 'gcode', fileName: 'soporte-celular.gcode', slicer: 'cura' },
  },
  {
    name: 'Engranaje de 24 dientes',
    material: 'PETG',
    dimensionsMm: { x: 55, y: 55, z: 10 },
    estimatedWeightGrams: 21,
    estimatedPrintSeconds: 4320,
    layerHeightUm: 160,
    source: { kind: 'manual' },
  },
  {
    name: 'Cubo de calibración 20 mm',
    material: 'PLA',
    dimensionsMm: { x: 24, y: 24, z: 21 },
    estimatedWeightGrams: 6,
    estimatedPrintSeconds: 2305,
    layerHeightUm: 160,
    suggestedPrinterName: 'Creality Ender-3 Pro',
    source: { kind: 'gcode', fileName: 'cubo-calibracion-20mm.gcode', slicer: 'cura' },
  },
];

interface ListedPart {
  name: string;
  material: string;
}

const keyOf = (p: ListedPart): string => `${p.name}|${p.material}`;

function isListedPart(value: unknown): value is ListedPart {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'material' in value &&
    typeof value.material === 'string'
  );
}

// shortcut: only the first 100 live parts are compared, so with more than 100 an already loaded
// sample could be created again; follow the pages if the seed is ever run on a large catalogue.
async function existingKeys(url: string): Promise<Set<string>> {
  const response = await fetch(`${url}?pageSize=100`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`listing parts answered ${String(response.status)}`);
  const body: unknown = await response.json();
  const items: unknown[] =
    typeof body === 'object' && body !== null && 'items' in body && Array.isArray(body.items)
      ? body.items
      : [];
  return new Set(items.filter(isListedPart).map(keyOf));
}

async function seed(): Promise<void> {
  if (config.env === 'production') {
    logger.fatal('refusing to load sample parts in production');
    process.exitCode = 1;
    return;
  }

  const url = `http://${config.host}:${String(config.port)}/api/v1/parts`;
  const existing = await existingKeys(url);
  for (const part of PARTS) {
    const label = { name: part.name, material: part.material };
    if (existing.has(keyOf(part))) {
      logger.info(label, 'part skipped: it already exists');
      continue;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(part),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 201) {
      logger.info(label, 'part created');
    } else {
      logger.error({ ...label, status: response.status }, 'part was not created');
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
