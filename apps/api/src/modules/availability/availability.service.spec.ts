import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { DEFAULT_SCHEDULE } from './availability.domain.js';
import { createAvailabilityService } from './availability.service.js';
import { createFakeScheduleRepository, createTestClock, validRules } from './testing/fakes.js';

function setup() {
  const repository = createFakeScheduleRepository();
  const clock = createTestClock();
  return { service: createAvailabilityService({ repository, clock }), repository, clock };
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

describe('availability service', () => {
  it('answers the defaults and does not write when never saved', async () => {
    const { service, repository } = setup();

    expect(await service.getSchedule()).toEqual(DEFAULT_SCHEDULE);
    expect(repository.calls).toEqual(['find']);
    expect(repository.stored).toBeNull();
  });

  it('creates with version 0 and stamps the injected clock', async () => {
    const { service, repository, clock } = setup();

    const saved = await service.saveSchedule({ ...validRules, version: 0 });

    expect(saved).toEqual({ ...validRules, version: 1, updatedAt: clock.now() });
    expect(repository.calls).toEqual(['create']);
  });

  it('updates with the current version and bumps it', async () => {
    const { service, repository, clock } = setup();
    await service.saveSchedule({ ...validRules, version: 0 });
    clock.advanceSeconds(60);

    const saved = await service.saveSchedule({ ...validRules, exceptions: [], version: 1 });

    expect(saved).toMatchObject({ version: 2, exceptions: [], updatedAt: clock.now() });
    expect(repository.stored?.version).toBe(2);
  });

  it('stores the absences it is given and replaces them on update', async () => {
    const { service } = setup();
    const first = await service.saveSchedule({ ...validRules, version: 0 });

    const second = await service.saveSchedule({ ...validRules, absences: [], version: 1 });

    expect(first.absences).toEqual(validRules.absences);
    expect(second.absences).toEqual([]);
  });

  it('answers a conflict on version for a stale version and keeps the stored schedule', async () => {
    const { service, repository } = setup();
    await service.saveSchedule({ ...validRules, version: 0 });
    const before = repository.stored;

    const error = await failureOf(service.saveSchedule({ ...validRules, version: 5 }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(repository.stored).toBe(before);
  });

  it('answers a conflict for version 0 over an existing schedule', async () => {
    const { service, repository } = setup();
    await service.saveSchedule({ ...validRules, version: 0 });

    const error = await failureOf(service.saveSchedule({ ...validRules, version: 0 }));

    expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'version' }] });
    expect(repository.stored?.version).toBe(1);
  });

  it.each([
    ['read', (s: ReturnType<typeof setup>) => s.service.getSchedule()],
    [
      'first save',
      (s: ReturnType<typeof setup>) => s.service.saveSchedule({ ...validRules, version: 0 }),
    ],
    [
      'update',
      (s: ReturnType<typeof setup>) => s.service.saveSchedule({ ...validRules, version: 1 }),
    ],
  ])('turns a repository failure on %s into a generic 503', async (_label, run) => {
    const context = setup();
    context.repository.failWith = new Error('MongoNetworkError: ECONNREFUSED 10.1.2.3');

    const error = await failureOf(run(context));

    expect(error.code).toBe('service_unavailable');
    expect(error.message).not.toMatch(/Mongo|ECONNREFUSED|10\.1\.2\.3/);
  });
});
