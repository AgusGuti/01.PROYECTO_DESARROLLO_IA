import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { createPartsService, type NewPart } from './parts.service.js';
import { createFakePartRepository, createTestClock } from './testing/fakes.js';

function setup() {
  const repository = createFakePartRepository();
  const clock = createTestClock();
  const service = createPartsService({ repository, clock });
  return { repository, clock, service };
}

const newPart: NewPart = {
  name: 'Soporte de estante en L',
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: 5700,
  layerHeightUm: 200,
};

const gcodeSource = { kind: 'gcode', fileName: 'florero.gcode', slicer: 'cura' } as const;

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

describe('create', () => {
  it('stamps version 1, the clock time and a manual source by default', async () => {
    const { service, clock } = setup();

    const part = await service.create(newPart);

    expect(part).toMatchObject({
      description: null,
      suggestedPrinterName: null,
      source: { kind: 'manual' },
      version: 1,
      deletedAt: null,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
  });

  it('stamps analyzedAt on a gcode source from the clock', async () => {
    const { service, clock } = setup();

    const part = await service.create({ ...newPart, source: gcodeSource });

    expect(part.source).toEqual({ ...gcodeSource, analyzedAt: clock.now() });
  });

  it('keeps the optional texts when given', async () => {
    const { service } = setup();

    const part = await service.create({
      ...newPart,
      description: 'Para estantes',
      suggestedPrinterName: 'Creality Ender-3 Pro',
    });

    expect(part).toMatchObject({
      description: 'Para estantes',
      suggestedPrinterName: 'Creality Ender-3 Pro',
    });
  });

  it('allows two parts with the same name', async () => {
    const { service, repository } = setup();

    const first = await service.create(newPart);
    const second = await service.create(newPart);

    expect(second.id).not.toBe(first.id);
    expect(repository.stored.size).toBe(2);
  });

  it('fails with the dependency error and stores nothing', async () => {
    const { service, repository } = setup();
    repository.failWith = new AppError('service_unavailable', 'The part data is down.');

    const error = await failureOf(service.create(newPart));

    expect(error.code).toBe('service_unavailable');
    expect(repository.stored.size).toBe(0);
  });
});

describe('update', () => {
  it('applies the patch, bumps the version and stamps updatedAt', async () => {
    const { service, repository, clock } = setup();
    const part = repository.seed();
    clock.advanceSeconds(30);

    const updated = await service.update(part.id, { version: 1, name: 'Otro', layerHeightUm: 160 });

    expect(updated).toMatchObject({
      name: 'Otro',
      layerHeightUm: 160,
      version: 2,
      updatedAt: clock.now(),
      createdAt: part.createdAt,
    });
  });

  it('replaces the dimensions whole', async () => {
    const { service, repository } = setup();
    const part = repository.seed();

    const updated = await service.update(part.id, {
      version: 1,
      dimensionsMm: { x: 1, y: 2, z: 3 },
    });

    expect(updated.dimensionsMm).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('clears the description and the suggested printer with null', async () => {
    const { service, repository } = setup();
    const part = repository.seed({ description: 'Algo', suggestedPrinterName: 'Ender' });

    const updated = await service.update(part.id, {
      version: 1,
      description: null,
      suggestedPrinterName: null,
    });

    expect(updated).toMatchObject({ description: null, suggestedPrinterName: null });
  });

  it('keeps the optional texts when the patch leaves them out', async () => {
    const { service, repository } = setup();
    const part = repository.seed({ description: 'Algo', suggestedPrinterName: 'Ender' });

    const updated = await service.update(part.id, { version: 1, name: 'Otro' });

    expect(updated).toMatchObject({ description: 'Algo', suggestedPrinterName: 'Ender' });
  });

  it('stamps analyzedAt again when the patch carries a gcode source', async () => {
    const { service, repository, clock } = setup();
    const part = repository.seed({
      source: { ...gcodeSource, analyzedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    clock.advanceSeconds(3600);

    const updated = await service.update(part.id, { version: 1, source: gcodeSource });

    expect(updated.source).toEqual({ ...gcodeSource, analyzedAt: clock.now() });
  });

  it('keeps the old analyzedAt when the patch has no source', async () => {
    const { service, repository, clock } = setup();
    const analyzedAt = new Date('2026-01-01T00:00:00.000Z');
    const part = repository.seed({ source: { ...gcodeSource, analyzedAt } });
    clock.advanceSeconds(3600);

    const updated = await service.update(part.id, { version: 1, name: 'Otro' });

    expect(updated.source).toEqual({ ...gcodeSource, analyzedAt });
  });

  it('switches to a manual source and drops the gcode data', async () => {
    const { service, repository } = setup();
    const part = repository.seed({
      source: { ...gcodeSource, analyzedAt: new Date('2026-01-01T00:00:00.000Z') },
    });

    const updated = await service.update(part.id, { version: 1, source: { kind: 'manual' } });

    expect(updated.source).toEqual({ kind: 'manual' });
  });

  it('answers 409 on version for a stale version before any write', async () => {
    const { service, repository } = setup();
    const part = repository.seed({ version: 4 });

    const error = await failureOf(service.update(part.id, { version: 3, name: 'Otro' }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(repository.calls).not.toContain('update');
    expect(repository.stored.get(part.id)).toEqual(part);
  });

  it('answers 404 before 409 for a missing part with any version', async () => {
    const { service } = setup();

    const error = await failureOf(service.update('0'.repeat(24), { version: 9, name: 'x' }));

    expect(error.code).toBe('not_found');
  });

  it('answers 404 for a deleted part', async () => {
    const { service, repository } = setup();
    const gone = repository.seed({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    const error = await failureOf(service.update(gone.id, { version: 1, name: 'x' }));

    expect(error.code).toBe('not_found');
  });

  it('answers 409 when the conditional write misses because the version moved', async () => {
    const { service, repository } = setup();
    const part = repository.seed();
    const original = repository.update.bind(repository);
    // Another request edits between the service read and its write.
    repository.update = async (id, version, patch, now) => {
      await original(id, version, { name: 'Otro' }, now);
      return original(id, version, patch, now);
    };

    const error = await failureOf(service.update(part.id, { version: 1, layerHeightUm: 160 }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
  });

  it('answers 404 when the part is deleted between the read and the write', async () => {
    const { service, repository } = setup();
    const part = repository.seed();
    const original = repository.update.bind(repository);
    repository.update = async (id, version, patch, now) => {
      await repository.softDelete(id, now);
      return original(id, version, patch, now);
    };

    const error = await failureOf(service.update(part.id, { version: 1, name: 'Otro' }));

    expect(error.code).toBe('not_found');
  });
});

describe('remove', () => {
  it('deletes logically and then answers 404', async () => {
    const { service, repository } = setup();
    const part = repository.seed();

    await service.remove(part.id);

    expect(repository.stored.get(part.id)).toMatchObject({ version: 2 });
    expect((await failureOf(service.remove(part.id))).code).toBe('not_found');
    expect((await failureOf(service.get(part.id))).code).toBe('not_found');
  });

  it('answers 404 for a missing part', async () => {
    const { service } = setup();

    expect((await failureOf(service.remove('0'.repeat(24)))).code).toBe('not_found');
  });
});

describe('list and get', () => {
  it('passes the query to the repository and returns its page', async () => {
    const { service, repository } = setup();
    repository.seed();

    const page = await service.list({ page: 1, pageSize: 20, sort: 'name', order: 'asc' });

    expect(page.total).toBe(1);
  });

  it('answers 404 for a missing part', async () => {
    const { service } = setup();

    expect((await failureOf(service.get('0'.repeat(24)))).code).toBe('not_found');
  });
});
