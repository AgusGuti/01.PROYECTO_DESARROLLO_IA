// Use cases for availability (CU09). Knows nothing about HTTP or MongoDB.
import { AppError } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import { DEFAULT_SCHEDULE, type Schedule, type ScheduleRules } from './availability.domain.js';

export interface ScheduleRepository {
  /** The schedule document, or null when never saved. Never writes. */
  find(): Promise<Schedule | null>;
  /** First save. @throws AppError `conflict` (issue path `version`) when a document exists. */
  create(rules: ScheduleRules, now: Date): Promise<Schedule>;
  /** One atomic write guarded by the version; `null` when the version is stale. */
  update(rules: ScheduleRules, version: number, now: Date): Promise<Schedule | null>;
}

export interface ScheduleEdit extends ScheduleRules {
  readonly version: number;
}

export interface AvailabilityService {
  getSchedule(): Promise<Schedule>;
  saveSchedule(edit: ScheduleEdit): Promise<Schedule>;
}

const staleVersion = (): AppError =>
  new AppError('conflict', 'The schedule was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });

/** Fails closed: a dependency that breaks is a 503, never "the schedule does not exist". */
async function dependable<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The schedule is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createAvailabilityService(deps: {
  repository: ScheduleRepository;
  clock: Clock;
}): AvailabilityService {
  const { repository, clock } = deps;

  return {
    async getSchedule() {
      return (await dependable(() => repository.find())) ?? DEFAULT_SCHEDULE;
    },

    async saveSchedule(edit) {
      const { version, weekly, exceptions, absences } = edit;
      const rules = { weekly, exceptions, absences };
      const now = clock.now();
      if (version === 0) return dependable(() => repository.create(rules, now));
      const updated = await dependable(() => repository.update(rules, version, now));
      if (updated === null) throw staleVersion();
      return updated;
    },
  };
}
