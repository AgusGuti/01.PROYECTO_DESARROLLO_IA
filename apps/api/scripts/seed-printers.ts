// Usage: npm run db:seed (from the repository root, with the API running: npm run dev).
// Loads five real printer models through the public API, so every value goes through the same
// validation as a user's request. Safe to repeat: a name that already exists is skipped.
// Development only; it refuses to run when NODE_ENV is production.
import { loadConfigFromEnvironment } from '../src/config/env.js';
import { createLogger } from '../src/shared/logging/logger.js';

const config = loadConfigFromEnvironment();
const logger = createLogger(config);

// Sources: manufacturer and retailer spec sheets (June 2026). `typicalSpeedMmS` is a realistic
// everyday speed, not the marketing maximum, and is an estimate where no vendor figure exists.
// `powerWatts` is the average draw while printing: also an estimate, to be replaced with a
// wattmeter reading of your own printer.
const PRINTERS = [
  {
    name: 'Creality Ender-3 V2 Neo',
    buildVolume: { x: 220, y: 220, z: 250 },
    nozzle: { diameterMm: 0.4, material: 'brass' },
    compatibleMaterials: ['PLA', 'PETG', 'TPU', 'ABS'],
    typicalSpeedMmS: 60,
    powerWatts: 150,
  },
  {
    // ABS, ASA and PC need an enclosure, sold separately by Prusa.
    name: 'Prusa MK4S',
    buildVolume: { x: 250, y: 210, z: 220 },
    nozzle: { diameterMm: 0.4, material: 'brass' },
    compatibleMaterials: ['PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'PC'],
    typicalSpeedMmS: 100,
    powerWatts: 120,
  },
  {
    name: 'Bambu Lab X1 Carbon',
    buildVolume: { x: 256, y: 256, z: 256 },
    nozzle: { diameterMm: 0.4, material: 'hardened_steel' },
    compatibleMaterials: [
      'PLA',
      'PETG',
      'TPU',
      'ABS',
      'ASA',
      'PVA',
      'PA',
      'PC',
      'PLA_CF',
      'PETG_CF',
      'PA_CF',
      'PA_GF',
    ],
    typicalSpeedMmS: 200,
    powerWatts: 150,
  },
  {
    // Bambu rates it for PLA, PETG, TPU and PVA only (open frame, 80 °C bed).
    name: 'Bambu Lab A1 mini',
    buildVolume: { x: 180, y: 180, z: 180 },
    nozzle: { diameterMm: 0.4, material: 'stainless_steel' },
    compatibleMaterials: ['PLA', 'PETG', 'TPU', 'PVA'],
    typicalSpeedMmS: 150,
    powerWatts: 80,
  },
  {
    name: 'Elegoo Neptune 4 Pro',
    buildVolume: { x: 225, y: 225, z: 265 },
    nozzle: { diameterMm: 0.4, material: 'brass' },
    compatibleMaterials: ['PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'PA'],
    typicalSpeedMmS: 250,
    powerWatts: 150,
  },
];

async function seed(): Promise<void> {
  if (config.env === 'production') {
    logger.fatal('refusing to load sample printers in production');
    process.exitCode = 1;
    return;
  }

  const url = `http://${config.host}:${String(config.port)}/api/v1/printers`;
  for (const printer of PRINTERS) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(printer),
    });
    if (response.status === 201) {
      logger.info({ name: printer.name }, 'printer created');
    } else if (response.status === 409) {
      logger.info({ name: printer.name }, 'printer skipped: the name is already taken');
    } else {
      logger.error({ name: printer.name, status: response.status }, 'printer was not created');
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
