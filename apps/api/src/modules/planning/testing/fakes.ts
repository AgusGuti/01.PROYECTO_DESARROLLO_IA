// Test doubles for the planning module: an in-memory settings repository and a fixed clock.
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../health/index.js';
import type { PlanningRates, PlanningSettings } from '../planning.domain.js';
import type { PlanningSettingsRepository } from '../planning.service.js';

export function createTestClock(start = '2026-03-01T10:00:00.000Z'): Clock {
  return { now: () => new Date(start) };
}

export const validRates: PlanningRates = { batchSavingBasisPoints: 1500 };

export interface FakePlanningSettingsRepository extends PlanningSettingsRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  /** The stored document, or null when never saved. */
  stored: PlanningSettings | null;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
}

export function createFakeSettingsRepository(): FakePlanningSettingsRepository {
  const guard = (name: string): void => {
    repository.calls.push(name);
    if (repository.failWith !== undefined) throw repository.failWith;
  };

  const repository: FakePlanningSettingsRepository = {
    calls: [],
    stored: null,
    failWith: undefined,

    find() {
      guard('find');
      return Promise.resolve(repository.stored);
    },

    create(rates, now) {
      guard('create');
      if (repository.stored !== null) {
        return Promise.reject(
          new AppError('conflict', 'The settings were changed by someone else.', {
            issues: [{ path: 'version', message: 'Does not match the current version.' }],
          }),
        );
      }
      repository.stored = { ...rates, version: 1, updatedAt: now };
      return Promise.resolve(repository.stored);
    },

    update(rates, version, now) {
      guard('update');
      if (repository.stored?.version !== version) return Promise.resolve(null);
      repository.stored = { ...rates, version: version + 1, updatedAt: now };
      return Promise.resolve(repository.stored);
    },
  };
  return repository;
}
