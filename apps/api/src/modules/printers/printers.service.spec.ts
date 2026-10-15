import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { createPrintersService, type PrinterUsageCheck } from './printers.service.js';
import { createFakePrinterRepository, createTestClock } from './testing/fakes.js';

function setup(hasAssignments: PrinterUsageCheck = () => Promise.resolve(false)) {
  const repository = createFakePrinterRepository();
  const clock = createTestClock();
  const service = createPrintersService({ repository, clock, hasAssignments });
  return { repository, clock, service };
}

const newPrinter = {
  name: 'Ender 3',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.4, material: 'brass' },
  compatibleMaterials: ['PLA'],
  status: 'available',
} as const;

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

describe('create', () => {
  it('stores the printer with version 1, no speed as null, and the clock time', async () => {
    const { service, clock } = setup();

    const { printer, restored } = await service.create(newPrinter);

    expect(restored).toBe(false);
    expect(printer).toMatchObject({
      name: 'Ender 3',
      typicalSpeedMmS: null,
      version: 1,
      archivedAt: null,
      deletedAt: null,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
  });

  it('keeps a given power and stores a missing one as null', async () => {
    const { service } = setup();

    const withPower = await service.create({ ...newPrinter, powerWatts: 120 });
    const without = await service.create({ ...newPrinter, name: 'Other' });

    expect(withPower.printer.powerWatts).toBe(120);
    expect(without.printer.powerWatts).toBeNull();
  });

  it('keeps a given speed', async () => {
    const { service } = setup();

    const { printer } = await service.create({ ...newPrinter, typicalSpeedMmS: 80 });

    expect(printer).toMatchObject({ typicalSpeedMmS: 80 });
  });

  it('rejects a reinforced material on a brass nozzle with an issue on compatibleMaterials', async () => {
    const { service, repository } = setup();

    const error = await failureOf(
      service.create({ ...newPrinter, compatibleMaterials: ['PLA', 'PA_CF'] }),
    );

    expect(error).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(error.issues).toEqual([
      { path: 'compatibleMaterials', message: expect.stringContaining('PA_CF') },
    ]);
    expect(repository.stored.size).toBe(0);
  });

  it('accepts a reinforced material with a hardened steel nozzle', async () => {
    const { service } = setup();

    const { printer } = await service.create({
      ...newPrinter,
      nozzle: { diameterMm: 0.6, material: 'hardened_steel' },
      compatibleMaterials: ['PLA_CF'],
    });

    expect(printer.compatibleMaterials).toEqual(['PLA_CF']);
  });

  it('passes a duplicate name conflict through', async () => {
    const { service } = setup();
    await service.create(newPrinter);

    const error = await failureOf(service.create({ ...newPrinter, name: 'ENDER 3' }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'name' }] });
  });

  describe('with a deleted printer holding the name', () => {
    const deletedAt = new Date('2026-02-01T00:00:00.000Z');

    it('answers a conflict on restoreIfDeleted and never calls restore without the flag', async () => {
      const { service, repository } = setup();
      repository.seed({ deletedAt });

      const error = await failureOf(service.create(newPrinter));

      expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'restoreIfDeleted' }] });
      expect(repository.calls).not.toContain('restore');
    });

    it('restores it with the submitted data when the flag is true', async () => {
      const { service, repository, clock } = setup();
      const old = repository.seed({ deletedAt, typicalSpeedMmS: 99, version: 4 });

      const result = await service.create({
        ...newPrinter,
        name: 'ENDER 3',
        restoreIfDeleted: true,
      });

      expect(result.restored).toBe(true);
      expect(result.printer).toEqual({
        ...old,
        name: 'ENDER 3',
        buildVolume: newPrinter.buildVolume,
        nozzle: newPrinter.nozzle,
        compatibleMaterials: ['PLA'],
        typicalSpeedMmS: null,
        powerWatts: null,
        status: 'available',
        deletedAt: null,
        archivedAt: null,
        version: 5,
        updatedAt: clock.now(),
      });
      expect(repository.calls).not.toContain('create');
    });

    it('checks the domain rule before any write when restoring', async () => {
      const { service, repository } = setup();
      const old = repository.seed({ deletedAt });

      const error = await failureOf(
        service.create({ ...newPrinter, compatibleMaterials: ['PA_CF'], restoreIfDeleted: true }),
      );

      expect(error.code).toBe('validation_failed');
      expect(repository.calls).toEqual([]);
      expect(repository.stored.get(old.id)).toEqual(old);
    });

    it('creates normally when the flag is true but no deleted printer matches', async () => {
      const { service, repository } = setup();

      const result = await service.create({ ...newPrinter, restoreIfDeleted: true });

      expect(result.restored).toBe(false);
      expect(repository.calls).toEqual(['restore', 'create']);
    });

    it('answers a conflict on name when the flag is true but a live printer holds the name', async () => {
      const { service, repository } = setup();
      repository.seed();

      const error = await failureOf(service.create({ ...newPrinter, restoreIfDeleted: true }));

      expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'name' }] });
    });
  });
});

describe('unarchive', () => {
  const archivedAt = new Date('2026-02-01T00:00:00.000Z');

  it('clears archivedAt, bumps the version and stamps the clock time', async () => {
    const { service, repository, clock } = setup();
    const printer = repository.seed({ archivedAt });

    const result = await service.unarchive(printer.id);

    expect(result).toEqual({
      ...printer,
      archivedAt: null,
      version: 2,
      updatedAt: clock.now(),
    });
  });

  it('returns a live printer that is not archived unchanged, without bumping the version', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();

    expect(await service.unarchive(printer.id)).toEqual(printer);
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('answers not found for a missing printer', async () => {
    const { service } = setup();

    expect(await failureOf(service.unarchive('0'.repeat(24)))).toMatchObject({
      code: 'not_found',
    });
  });

  it('answers not found for a deleted printer and leaves it untouched', async () => {
    const { service, repository } = setup();
    const printer = repository.seed({ deletedAt: archivedAt });

    expect(await failureOf(service.unarchive(printer.id))).toMatchObject({ code: 'not_found' });
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('propagates a repository failure', async () => {
    const { service, repository } = setup();
    repository.failWith = new AppError('service_unavailable', 'The printer data is unavailable.');

    expect(await failureOf(service.unarchive('0'.repeat(24)))).toMatchObject({ status: 503 });
  });
});

describe('get', () => {
  it('returns an archived printer', async () => {
    const { service, repository } = setup();
    const archived = repository.seed({ archivedAt: new Date('2026-02-01T00:00:00.000Z') });

    expect(await service.get(archived.id)).toEqual(archived);
  });

  it('answers not found for a missing printer', async () => {
    const { service } = setup();

    expect(await failureOf(service.get('0'.repeat(24)))).toMatchObject({ code: 'not_found' });
  });

  it('answers not found for a deleted printer', async () => {
    const { service, repository } = setup();
    const deleted = repository.seed({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    expect(await failureOf(service.get(deleted.id))).toMatchObject({ code: 'not_found' });
  });
});

describe('update', () => {
  it('merges the patch, bumps the version and stamps the clock time', async () => {
    const { service, repository, clock } = setup();
    const printer = repository.seed();
    clock.advanceSeconds(60);

    const updated = await service.update(printer.id, { version: 1, name: 'Prusa' });

    expect(updated).toMatchObject({
      name: 'Prusa',
      version: 2,
      nozzle: printer.nozzle,
      updatedAt: clock.now(),
    });
  });

  it('clears the speed when null is sent', async () => {
    const { service, repository } = setup();
    const printer = repository.seed({ typicalSpeedMmS: 60 });

    const updated = await service.update(printer.id, { version: 1, typicalSpeedMmS: null });

    expect(updated.typicalSpeedMmS).toBeNull();
  });

  it('answers not found for a missing printer', async () => {
    const { service } = setup();

    const error = await failureOf(service.update('0'.repeat(24), { version: 1, name: 'x' }));

    expect(error.code).toBe('not_found');
  });

  it('answers 409 on the version path before writing when the version is stale', async () => {
    const { service, repository } = setup();
    const printer = repository.seed({ version: 3 });

    const error = await failureOf(service.update(printer.id, { version: 2, name: 'Prusa' }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(repository.calls).not.toContain('update');
  });

  it('answers 409 for a version from the future too', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();

    const error = await failureOf(service.update(printer.id, { version: 9, name: 'Prusa' }));

    expect(error.issues).toEqual([{ path: 'version', message: expect.any(String) }]);
  });

  it('refuses to edit an archived printer', async () => {
    const { service, repository } = setup();
    const printer = repository.seed({ archivedAt: new Date('2026-02-01T00:00:00.000Z') });

    const error = await failureOf(service.update(printer.id, { version: 1, name: 'Prusa' }));

    expect(error.code).toBe('conflict');
    expect(repository.calls).not.toContain('update');
  });

  it('classifies a lost race as a stale version', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();
    const realUpdate = repository.update.bind(repository);
    repository.update = async (id, version, patch, now) => {
      // Someone else saves between our read and our write.
      await realUpdate(id, version, { status: 'maintenance' }, now);
      return realUpdate(id, version, patch, now);
    };

    const error = await failureOf(service.update(printer.id, { version: 1, name: 'Prusa' }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
  });

  it('answers not found when the printer is deleted between read and write', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();
    repository.update = (id) => {
      const current = repository.stored.get(id);
      if (current !== undefined) {
        repository.stored.set(id, { ...current, deletedAt: new Date('2026-02-01T00:00:00.000Z') });
      }
      return Promise.resolve(null);
    };

    const error = await failureOf(service.update(printer.id, { version: 1, name: 'Prusa' }));

    expect(error.code).toBe('not_found');
  });

  describe('domain rule on the merged state', () => {
    const hardenedWithCarbon = {
      nozzle: { diameterMm: 0.4, material: 'hardened_steel' },
      compatibleMaterials: ['PLA', 'PLA_CF'],
    } as const;

    it('rejects a nozzle change to brass while a reinforced material is listed', async () => {
      const { service, repository } = setup();
      const printer = repository.seed(hardenedWithCarbon);

      const error = await failureOf(
        service.update(printer.id, { version: 1, nozzle: { diameterMm: 0.4, material: 'brass' } }),
      );

      expect(error).toMatchObject({
        code: 'validation_failed',
        issues: [{ path: 'compatibleMaterials' }],
      });
      expect(repository.stored.get(printer.id)?.version).toBe(1);
    });

    it('rejects adding a reinforced material to a brass nozzle', async () => {
      const { service, repository } = setup();
      const printer = repository.seed();

      const error = await failureOf(
        service.update(printer.id, { version: 1, compatibleMaterials: ['PA_GF'] }),
      );

      expect(error.code).toBe('validation_failed');
    });

    it('accepts changing nozzle and materials together to hardened steel with carbon', async () => {
      const { service, repository } = setup();
      const printer = repository.seed();

      const updated = await service.update(printer.id, {
        version: 1,
        ...hardenedWithCarbon,
      });

      expect(updated).toMatchObject(hardenedWithCarbon);
    });

    it('accepts an unrelated change on a valid reinforced printer', async () => {
      const { service, repository } = setup();
      const printer = repository.seed(hardenedWithCarbon);

      const updated = await service.update(printer.id, { version: 1, name: 'Renamed' });

      expect(updated.name).toBe('Renamed');
    });
  });
});

describe('remove', () => {
  const frozen = '2026-03-01T10:00:00.000Z';

  it('soft-deletes an idle printer with the clock time', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();

    await service.remove(printer.id);

    expect(repository.stored.get(printer.id)).toMatchObject({
      deletedAt: new Date(frozen),
      archivedAt: null,
    });
    expect(repository.calls).not.toContain('archive');
  });

  it('soft-deletes a printer in maintenance that has no assignments', async () => {
    const { service, repository } = setup();
    const printer = repository.seed({ status: 'maintenance' });

    await service.remove(printer.id);

    expect(repository.stored.get(printer.id)?.deletedAt).toEqual(new Date(frozen));
  });

  it('archives a printer that is in use', async () => {
    const { service, repository } = setup();
    const printer = repository.seed({ status: 'in_use' });

    await service.remove(printer.id);

    expect(repository.stored.get(printer.id)).toMatchObject({
      archivedAt: new Date(frozen),
      deletedAt: null,
    });
    expect(repository.calls).not.toContain('softDelete');
  });

  it('archives an idle printer that has assignments', async () => {
    const { service, repository } = setup(() => Promise.resolve(true));
    const printer = repository.seed();

    await service.remove(printer.id);

    expect(repository.stored.get(printer.id)).toMatchObject({
      archivedAt: new Date(frozen),
      deletedAt: null,
    });
  });

  it('asks the usage check about the right printer', async () => {
    const asked: string[] = [];
    const { service, repository } = setup((id) => {
      asked.push(id);
      return Promise.resolve(false);
    });
    const printer = repository.seed();

    await service.remove(printer.id);

    expect(asked).toEqual([printer.id]);
  });

  it('fails closed and changes nothing when the usage check fails', async () => {
    const { service, repository } = setup(() => Promise.reject(new Error('queue unreachable')));
    const printer = repository.seed();

    await expect(service.remove(printer.id)).rejects.toThrow('queue unreachable');

    expect(repository.calls).not.toContain('softDelete');
    expect(repository.calls).not.toContain('archive');
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('is a no-op for an already archived printer', async () => {
    const { service, repository } = setup();
    const printer = repository.seed({ archivedAt: new Date('2026-02-01T00:00:00.000Z') });

    await service.remove(printer.id);

    expect(repository.calls).toEqual(['findLiveById']);
    expect(repository.stored.get(printer.id)).toEqual(printer);
  });

  it('answers not found for a missing printer', async () => {
    const { service } = setup();

    expect(await failureOf(service.remove('0'.repeat(24)))).toMatchObject({ code: 'not_found' });
  });

  it('answers not found when the printer was already deleted', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();
    await service.remove(printer.id);

    expect(await failureOf(service.remove(printer.id))).toMatchObject({ code: 'not_found' });
  });

  it('falls back to archiving when the printer became in use during the delete', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();
    const realSoftDelete = repository.softDelete.bind(repository);
    repository.softDelete = (id, now) => {
      const current = repository.stored.get(id);
      if (current !== undefined) repository.stored.set(id, { ...current, status: 'in_use' });
      return realSoftDelete(id, now);
    };

    await service.remove(printer.id);

    expect(repository.stored.get(printer.id)).toMatchObject({
      status: 'in_use',
      archivedAt: new Date(frozen),
      deletedAt: null,
    });
  });

  it('answers not found when another request deleted the printer first', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();
    repository.softDelete = (id) => {
      const current = repository.stored.get(id);
      if (current !== undefined) {
        repository.stored.set(id, { ...current, deletedAt: new Date(frozen) });
      }
      return Promise.resolve(null);
    };

    expect(await failureOf(service.remove(printer.id))).toMatchObject({ code: 'not_found' });
  });

  it('propagates a repository failure and writes nothing', async () => {
    const { service, repository } = setup();
    const printer = repository.seed();
    repository.failWith = new AppError('service_unavailable', 'The printer data is unavailable.');

    expect(await failureOf(service.remove(printer.id))).toMatchObject({ status: 503 });
  });
});

describe('list', () => {
  it('delegates to the repository with the query', async () => {
    const { service, repository } = setup();
    repository.seed({ name: 'B printer' });
    repository.seed({ name: 'a printer' });

    const page = await service.list({
      page: 1,
      pageSize: 10,
      sort: 'name',
      order: 'asc',
    });

    expect(page.items.map((p) => p.name)).toEqual(['a printer', 'B printer']);
    expect(page.total).toBe(2);
  });
});
