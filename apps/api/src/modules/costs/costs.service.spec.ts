import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { DEFAULT_COST_SETTINGS } from './costs.domain.js';
import { createCostsService } from './costs.service.js';
import {
  createFakes,
  createTestClock,
  FILAMENT_ID,
  OTHER_ID,
  PART_ID,
  PRINTER_ID,
  validRates,
} from './testing/fakes.js';

function setup() {
  const fakes = createFakes();
  const clock = createTestClock();
  const service = createCostsService({
    repository: fakes.settings,
    partReader: fakes.parts.read,
    filamentReader: fakes.filaments.read,
    printerReader: fakes.printers.read,
    clock,
  });
  return { service, clock, ...fakes };
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

const request = { partId: PART_ID, filamentId: FILAMENT_ID, quantity: 1 };

describe('estimate', () => {
  it('reads each port once, reads the settings and writes nothing', async () => {
    const { service, settings, parts, filaments, printers } = setup();
    settings.stored = { ...validRates, version: 3, updatedAt: new Date() };

    await service.estimate({ ...request, printerId: PRINTER_ID });

    expect(parts.calls).toEqual([PART_ID]);
    expect(filaments.calls).toEqual([FILAMENT_ID]);
    expect(printers.calls).toEqual([PRINTER_ID]);
    expect(settings.calls).toEqual(['find']);
  });

  it('does not call the printer port when no printer was requested', async () => {
    const { service, printers } = setup();

    const estimate = await service.estimate(request);

    expect(printers.calls).toEqual([]);
    expect(estimate.warnings).toContain('electricity_printer_not_selected');
  });

  it('uses the stored settings, not the defaults', async () => {
    const { service, settings } = setup();
    settings.stored = { ...validRates, version: 2, updatedAt: new Date() };

    const estimate = await service.estimate({ ...request, printerId: PRINTER_ID, quantity: 2 });

    expect(estimate).toMatchObject({ subtotalMinor: 414_240, totalMinor: 414_240 });
    expect(estimate.warnings).toEqual([]);
  });

  it('uses zero tariffs and warns when the settings were never saved', async () => {
    const { service } = setup();

    const estimate = await service.estimate(request);

    expect(estimate.warnings).toContain('settings_not_configured');
    expect(estimate.wear.costMinor).toBe(0);
    expect(estimate.fixed.costMinor).toBe(0);
  });

  it('applies no margin when none was requested, whatever the default margin is', async () => {
    const { service, settings } = setup();
    settings.stored = {
      ...validRates,
      defaultMarginBasisPoints: 5000,
      version: 1,
      updatedAt: null,
    };

    const estimate = await service.estimate(request);

    expect(estimate).toMatchObject({ marginBasisPoints: 0, marginMinor: 0 });
    expect(estimate.totalMinor).toBe(estimate.subtotalMinor);
  });

  it('applies the requested margin, 0 included', async () => {
    const { service } = setup();

    const sale = await service.estimate({ ...request, marginBasisPoints: 2500 });
    const zero = await service.estimate({ ...request, marginBasisPoints: 0 });

    expect(sale.marginMinor).toBeGreaterThan(0);
    expect(zero.marginMinor).toBe(0);
  });

  it('reports every missing reference together', async () => {
    const { service } = setup();

    const error = await failureOf(
      service.estimate({
        partId: OTHER_ID,
        filamentId: OTHER_ID,
        printerId: OTHER_ID,
        quantity: 1,
      }),
    );

    expect(error.code).toBe('validation_failed');
    expect(error.issues.map((issue) => issue.path)).toEqual(['partId', 'filamentId', 'printerId']);
    expect(error.issues[0]?.message).toBe('The part does not exist.');
  });

  it('reports only the printer when only the printer is missing', async () => {
    const { service } = setup();

    const error = await failureOf(service.estimate({ ...request, printerId: OTHER_ID }));

    expect(error.issues.map((issue) => issue.path)).toEqual(['printerId']);
  });

  it('rejects a spool whose material differs from the part material', async () => {
    const { service, filaments } = setup();
    filaments.records.set(FILAMENT_ID, {
      ...(filaments.records.get(FILAMENT_ID) ?? { id: FILAMENT_ID, initialGrams: 1 }),
      id: FILAMENT_ID,
      material: 'PLA',
      initialGrams: 1000,
      availableGrams: 1000,
      purchaseCostMinor: 1,
    });

    const error = await failureOf(service.estimate(request));

    expect(error.issues).toEqual([
      { path: 'filamentId', message: 'The spool material differs from the part material.' },
    ]);
  });

  it('answers amount_too_large as an issue on quantity', async () => {
    const { service, parts, filaments } = setup();
    parts.records.set(PART_ID, {
      id: PART_ID,
      material: 'PETG',
      estimatedWeightGrams: 20_000,
      estimatedPrintSeconds: 60,
    });
    filaments.records.set(FILAMENT_ID, {
      id: FILAMENT_ID,
      material: 'PETG',
      initialGrams: 1,
      availableGrams: 1,
      purchaseCostMinor: 1_000_000_000,
    });

    const error = await failureOf(service.estimate({ ...request, quantity: 1000 }));

    expect(error.code).toBe('validation_failed');
    expect(error.issues.map((issue) => issue.path)).toEqual(['quantity']);
  });

  it.each(['parts', 'filaments', 'printers', 'settings'] as const)(
    'fails closed with a 503 and no driver text when the %s dependency fails',
    async (name) => {
      const fakes = setup();
      fakes[name].failWith = new Error('MongoServerSelectionError: ECONNREFUSED 10.1.2.3:27017');

      const error = await failureOf(fakes.service.estimate({ ...request, printerId: PRINTER_ID }));

      expect(error.code).toBe('service_unavailable');
      expect(error.message).not.toContain('ECONNREFUSED');
      expect(fakes.settings.stored).toBeNull();
      expect(fakes.settings.calls.filter((call) => call !== 'find')).toEqual([]);
    },
  );

  it('keeps an AppError raised by a dependency as it is', async () => {
    const { service, parts } = setup();
    parts.failWith = new AppError(
      'service_unavailable',
      'The part data is temporarily unavailable.',
    );

    const error = await failureOf(service.estimate(request));

    expect(error.message).toBe('The part data is temporarily unavailable.');
  });
});

describe('getSettings', () => {
  it('answers the defaults without writing when nothing was saved', async () => {
    const { service, settings } = setup();

    expect(await service.getSettings()).toEqual(DEFAULT_COST_SETTINGS);
    expect(settings.calls).toEqual(['find']);
    expect(settings.stored).toBeNull();
  });

  it('answers the stored document', async () => {
    const { service, settings } = setup();
    settings.stored = { ...validRates, version: 4, updatedAt: new Date('2026-01-01T00:00:00Z') };

    expect(await service.getSettings()).toEqual(settings.stored);
  });
});

describe('saveSettings', () => {
  it('creates the document with version 1 when version 0 is sent on an empty store', async () => {
    const { service, clock } = setup();

    const saved = await service.saveSettings({ ...validRates, version: 0 });

    expect(saved).toEqual({ ...validRates, version: 1, updatedAt: clock.now() });
  });

  it('updates and bumps the version when the version matches', async () => {
    const { service, settings } = setup();
    await service.saveSettings({ ...validRates, version: 0 });

    const saved = await service.saveSettings({ ...validRates, kwhPriceMinor: 9000, version: 1 });

    expect(saved).toMatchObject({ kwhPriceMinor: 9000, version: 2 });
    expect(settings.calls).toEqual(['create', 'update']);
  });

  it.each([
    ['a stale version', 5, 1],
    ['version 0 when a document exists', 0, 1],
  ])('answers a conflict on version for %s', async (_label, sent, stored) => {
    const { service, settings } = setup();
    settings.stored = { ...validRates, version: stored, updatedAt: null };

    const error = await failureOf(service.saveSettings({ ...validRates, version: sent }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(settings.stored).toEqual({ ...validRates, version: stored, updatedAt: null });
  });

  it('answers a conflict for version 5 on an empty store', async () => {
    const { service } = setup();

    const error = await failureOf(service.saveSettings({ ...validRates, version: 5 }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
  });

  it('answers a 503 and no driver text when the repository fails', async () => {
    const { service, settings } = setup();
    settings.failWith = new Error('MongoNetworkError: connect ECONNREFUSED');

    const error = await failureOf(service.saveSettings({ ...validRates, version: 0 }));

    expect(error.code).toBe('service_unavailable');
    expect(error.message).not.toContain('ECONNREFUSED');
  });
});
