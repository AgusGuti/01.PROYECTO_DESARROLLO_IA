import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { DEFAULT_PLANNING_SETTINGS } from './planning.domain.js';
import { createPlanningService } from './planning.service.js';
import { createFakeSettingsRepository, createTestClock, validRates } from './testing/fakes.js';

function setup() {
  const repository = createFakeSettingsRepository();
  return { repository, service: createPlanningService({ repository, clock: createTestClock() }) };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

describe('planning service', () => {
  it('answers the defaults at version 0 and writes nothing before the first save', async () => {
    const { repository, service } = setup();

    expect(await service.getSettings()).toEqual(DEFAULT_PLANNING_SETTINGS);
    expect(repository.calls).toEqual(['find']);
    expect(repository.stored).toBeNull();
  });

  it('creates the settings with version 0 and answers version 1', async () => {
    const { service } = setup();

    const saved = await service.saveSettings({ ...validRates, version: 0 });

    expect(saved).toMatchObject({ batchSavingBasisPoints: 1500, version: 1 });
  });

  it('updates with the matching version and bumps it', async () => {
    const { service } = setup();
    await service.saveSettings({ ...validRates, version: 0 });

    const saved = await service.saveSettings({ batchSavingBasisPoints: 200, version: 1 });

    expect(saved).toMatchObject({ batchSavingBasisPoints: 200, version: 2 });
  });

  it('answers a conflict on version for a stale update', async () => {
    const { repository, service } = setup();
    await service.saveSettings({ ...validRates, version: 0 });

    const error = await failure(service.saveSettings({ batchSavingBasisPoints: 1, version: 5 }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(repository.stored?.batchSavingBasisPoints).toBe(1500);
  });

  it('answers a conflict when a second first save arrives', async () => {
    const { service } = setup();
    await service.saveSettings({ ...validRates, version: 0 });

    const error = await failure(service.saveSettings({ ...validRates, version: 0 }));

    expect(error.code).toBe('conflict');
  });

  it('turns a failing repository into a generic 503', async () => {
    const { repository, service } = setup();
    repository.failWith = new Error('MongoNetworkError: boom');

    const error = await failure(service.getSettings());

    expect(error.status).toBe(503);
    expect(error.message).not.toContain('boom');
  });
});
