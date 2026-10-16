// Test doubles for the availability module: an in-memory repository and a movable clock.
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../health/index.js';
import type { MinuteRange, Schedule, ScheduleRules } from '../availability.domain.js';
import type { ScheduleRepository } from '../availability.service.js';

export function createTestClock(start = '2026-03-01T10:00:00.000Z'): Clock & {
  advanceSeconds(seconds: number): void;
} {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advanceSeconds(seconds) {
      current = new Date(current.getTime() + seconds * 1000);
    },
  };
}

export const range = (startMinute: number, endMinute: number): MinuteRange => ({
  startMinute,
  endMinute,
});

/** A valid body: 7 days, Monday 08:00-12:00 and 14:00-18:00, the rest empty, one exception. */
export const validRules: ScheduleRules = {
  weekly: [
    { ranges: [range(480, 720), range(840, 1080)] },
    ...Array.from({ length: 6 }, () => ({ ranges: [] })),
  ],
  exceptions: [{ date: '2026-12-25', ranges: [] }],
};

export interface FakeScheduleRepository extends ScheduleRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  /** The stored document, or null when never saved. */
  stored: Schedule | null;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
}

export function createFakeScheduleRepository(): FakeScheduleRepository {
  const guard = (name: string): void => {
    repository.calls.push(name);
    if (repository.failWith !== undefined) throw repository.failWith;
  };

  const repository: FakeScheduleRepository = {
    calls: [],
    stored: null,
    failWith: undefined,

    find() {
      guard('find');
      return Promise.resolve(repository.stored);
    },

    create(rules, now) {
      guard('create');
      if (repository.stored !== null) {
        return Promise.reject(
          new AppError('conflict', 'The schedule was changed by someone else.', {
            issues: [{ path: 'version', message: 'Does not match the current version.' }],
          }),
        );
      }
      repository.stored = { ...rules, version: 1, updatedAt: now };
      return Promise.resolve(repository.stored);
    },

    update(rules, version, now) {
      guard('update');
      if (repository.stored?.version !== version) return Promise.resolve(null);
      repository.stored = { ...rules, version: version + 1, updatedAt: now };
      return Promise.resolve(repository.stored);
    },
  };
  return repository;
}
