import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { createFilamentsService } from './filaments.service.js';
import { createFakeFilamentRepository, createTestClock } from './testing/fakes.js';

function setup() {
  const repository = createFakeFilamentRepository();
  const clock = createTestClock();
  const service = createFilamentsService({ repository, clock });
  return { repository, clock, service };
}

const newFilament = {
  brand: 'Grilon3',
  material: 'PLA',
  colorName: 'Negro',
  initialGrams: 1000,
  purchaseCostMinor: 1_950_000,
  purchaseDate: new Date('2026-02-01T00:00:00.000Z'),
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
  it('defaults availableGrams to initialGrams and stamps version 1 and the clock time', async () => {
    const { service, clock } = setup();

    const filament = await service.create(newFilament);

    expect(filament).toMatchObject({
      initialGrams: 1000,
      availableGrams: 1000,
      version: 1,
      deletedAt: null,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
  });

  it('keeps a given availableGrams', async () => {
    const { service } = setup();

    const filament = await service.create({ ...newFilament, availableGrams: 640 });

    expect(filament.availableGrams).toBe(640);
  });

  it('rejects availableGrams above initialGrams with an issue on availableGrams', async () => {
    const { service, repository } = setup();

    const error = await failureOf(service.create({ ...newFilament, availableGrams: 1001 }));

    expect(error).toMatchObject({ code: 'validation_failed', status: 400 });
    expect(error.issues).toEqual([{ path: 'availableGrams', message: expect.any(String) }]);
    expect(repository.stored.size).toBe(0);
  });

  it('rejects a purchase date after the UTC day of the clock', async () => {
    const { service, repository } = setup();

    const error = await failureOf(
      service.create({ ...newFilament, purchaseDate: new Date('2026-03-02T00:00:00.000Z') }),
    );

    expect(error.issues).toEqual([{ path: 'purchaseDate', message: expect.any(String) }]);
    expect(repository.stored.size).toBe(0);
  });

  it('accepts the clock UTC day itself, even at 23:59:59.999Z', async () => {
    const repository = createFakeFilamentRepository();
    const service = createFilamentsService({
      repository,
      clock: createTestClock('2026-03-01T23:59:59.999Z'),
    });

    const filament = await service.create({
      ...newFilament,
      purchaseDate: new Date('2026-03-01T00:00:00.000Z'),
    });

    expect(filament.purchaseDate).toEqual(new Date('2026-03-01T00:00:00.000Z'));
  });

  it('rejects tomorrow at 00:00:00Z on the clock', async () => {
    const repository = createFakeFilamentRepository();
    const service = createFilamentsService({
      repository,
      clock: createTestClock('2026-03-02T00:00:00.000Z'),
    });

    const error = await failureOf(
      service.create({ ...newFilament, purchaseDate: new Date('2026-03-03T00:00:00.000Z') }),
    );

    expect(error.code).toBe('validation_failed');
  });

  it('allows two identical spools', async () => {
    const { service, repository } = setup();

    const first = await service.create(newFilament);
    const second = await service.create(newFilament);

    expect(second.id).not.toBe(first.id);
    expect(repository.stored.size).toBe(2);
  });
});

describe('update', () => {
  it('applies the patch, bumps the version and stamps updatedAt', async () => {
    const { service, repository, clock } = setup();
    const filament = repository.seed();
    clock.advanceSeconds(30);

    const updated = await service.update(filament.id, { version: 1, colorName: 'Rojo' });

    expect(updated).toMatchObject({ colorName: 'Rojo', version: 2, updatedAt: clock.now() });
  });

  it('rejects lowering initialGrams below availableGrams, on the merged state', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ initialGrams: 1000, availableGrams: 800 });

    const error = await failureOf(service.update(filament.id, { version: 1, initialGrams: 500 }));

    expect(error).toMatchObject({ code: 'validation_failed' });
    expect(error.issues).toEqual([{ path: 'availableGrams', message: expect.any(String) }]);
    expect(repository.stored.get(filament.id)).toEqual(filament);
  });

  it('allows lowering both in one patch', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ initialGrams: 1000, availableGrams: 800 });

    const updated = await service.update(filament.id, {
      version: 1,
      initialGrams: 500,
      availableGrams: 400,
    });

    expect(updated).toMatchObject({ initialGrams: 500, availableGrams: 400 });
  });

  it('rejects raising availableGrams above initialGrams', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ initialGrams: 1000, availableGrams: 800 });

    const error = await failureOf(
      service.update(filament.id, { version: 1, availableGrams: 1001 }),
    );

    expect(error.issues).toEqual([{ path: 'availableGrams', message: expect.any(String) }]);
  });

  it('checks the purchase date only when the patch carries one', async () => {
    const { service, repository } = setup();
    const legacy = repository.seed({ purchaseDate: new Date('2026-04-01T00:00:00.000Z') });

    const untouched = await service.update(legacy.id, { version: 1, colorName: 'Rojo' });
    const changed = await failureOf(
      service.update(legacy.id, {
        version: 2,
        purchaseDate: new Date('2026-04-02T00:00:00.000Z'),
      }),
    );

    expect(untouched.colorName).toBe('Rojo');
    expect(changed.issues).toEqual([{ path: 'purchaseDate', message: expect.any(String) }]);
  });

  it('answers 409 on version for a stale version before any write', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ version: 4 });

    const error = await failureOf(service.update(filament.id, { version: 3, colorName: 'Rojo' }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(repository.calls).not.toContain('update');
    expect(repository.stored.get(filament.id)).toEqual(filament);
  });

  it('answers 404 before 409 for a missing filament', async () => {
    const { service } = setup();

    const error = await failureOf(service.update('0'.repeat(24), { version: 9, colorName: 'x' }));

    expect(error.code).toBe('not_found');
  });

  it('answers 409 before 400 when the version is stale and the merged state is invalid', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ version: 2 });

    const error = await failureOf(service.update(filament.id, { version: 1, initialGrams: 1 }));

    expect(error.code).toBe('conflict');
  });

  it('answers 409 when the conditional write misses because the version moved', async () => {
    const { service, repository } = setup();
    const filament = repository.seed();
    const original = repository.update.bind(repository);
    // Another request edits between the service read and its write.
    repository.update = async (id, version, patch, now) => {
      await original(id, version, { colorName: 'Otro' }, now);
      return original(id, version, patch, now);
    };

    const error = await failureOf(service.update(filament.id, { version: 1, brand: 'X' }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
  });
});

describe('remove', () => {
  it('deletes logically and then answers 404', async () => {
    const { service, repository } = setup();
    const filament = repository.seed();

    await service.remove(filament.id);

    expect(repository.stored.get(filament.id)).toMatchObject({ version: 2 });
    expect((await failureOf(service.remove(filament.id))).code).toBe('not_found');
    expect((await failureOf(service.get(filament.id))).code).toBe('not_found');
  });

  it('answers 404 for a missing filament', async () => {
    const { service } = setup();

    expect((await failureOf(service.remove('0'.repeat(24)))).code).toBe('not_found');
  });
});

describe('consume', () => {
  it('takes the grams, bumps the version and stamps updatedAt', async () => {
    const { service, repository, clock } = setup();
    const filament = repository.seed({ availableGrams: 500 });
    clock.advanceSeconds(5);

    const updated = await service.consume(filament.id, 120);

    expect(updated).toMatchObject({ availableGrams: 380, version: 2, updatedAt: clock.now() });
  });

  it('empties the spool when grams equal what is left', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ availableGrams: 50 });

    expect((await service.consume(filament.id, 50)).availableGrams).toBe(0);
  });

  it('answers 409 on grams with a safe message and leaves the spool unchanged', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ availableGrams: 50 });

    const error = await failureOf(service.consume(filament.id, 51));

    expect(error).toMatchObject({
      code: 'conflict',
      issues: [{ path: 'grams', message: 'Not enough material available.' }],
    });
    expect(JSON.stringify({ m: error.message, i: error.issues })).not.toMatch(/\d/);
    expect(repository.stored.get(filament.id)).toEqual(filament);
  });

  it('answers 404 for a missing and for a deleted filament', async () => {
    const { service, repository } = setup();
    const gone = repository.seed({ deletedAt: new Date('2026-02-01T00:00:00.000Z') });

    expect((await failureOf(service.consume('0'.repeat(24), 1))).code).toBe('not_found');
    expect((await failureOf(service.consume(gone.id, 1))).code).toBe('not_found');
    expect(repository.stored.get(gone.id)).toEqual(gone);
  });

  it('does not use the version: a consume works after any number of edits', async () => {
    const { service, repository } = setup();
    const filament = repository.seed({ version: 9 });

    expect(await service.consume(filament.id, 1)).toMatchObject({ version: 10 });
  });

  it('never reads before writing: the first repository call is the atomic consume', async () => {
    const { service, repository } = setup();
    const filament = repository.seed();

    await service.consume(filament.id, 1);

    expect(repository.calls).toEqual(['consume']);
  });
});

describe('list and get', () => {
  it('passes the query to the repository and returns its page', async () => {
    const { service, repository } = setup();
    repository.seed();

    const page = await service.list({ page: 1, pageSize: 20, sort: 'createdAt', order: 'desc' });

    expect(page.total).toBe(1);
  });

  it('answers 404 for a missing filament', async () => {
    const { service } = setup();

    expect((await failureOf(service.get('0'.repeat(24)))).code).toBe('not_found');
  });
});
