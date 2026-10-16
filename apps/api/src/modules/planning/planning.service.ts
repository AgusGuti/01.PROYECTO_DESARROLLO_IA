// Use cases for the planning settings (ADR 0027). Knows nothing about HTTP or MongoDB.
import { AppError } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import {
  DEFAULT_PLANNING_SETTINGS,
  type PlanningRates,
  type PlanningSettings,
} from './planning.domain.js';

export interface PlanningSettingsRepository {
  /** The settings document, or null when never saved. Never writes. */
  find(): Promise<PlanningSettings | null>;
  /** First save. @throws AppError `conflict` (issue path `version`) when a document exists. */
  create(rates: PlanningRates, now: Date): Promise<PlanningSettings>;
  /** One atomic write guarded by the version; `null` when the version is stale. */
  update(rates: PlanningRates, version: number, now: Date): Promise<PlanningSettings | null>;
}

export interface PlanningSettingsEdit extends PlanningRates {
  readonly version: number;
}

export interface PlanningService {
  getSettings(): Promise<PlanningSettings>;
  saveSettings(edit: PlanningSettingsEdit): Promise<PlanningSettings>;
}

const staleVersion = (): AppError =>
  new AppError('conflict', 'The settings were changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });

/** Fails closed: a dependency that breaks is a 503, never "the record does not exist". */
async function dependable<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'service_unavailable',
      'The planning settings are temporarily unavailable.',
      {
        cause: error,
      },
    );
  }
}

export function createPlanningService(deps: {
  repository: PlanningSettingsRepository;
  clock: Clock;
}): PlanningService {
  const { repository, clock } = deps;
  return {
    async getSettings() {
      return (await dependable(() => repository.find())) ?? DEFAULT_PLANNING_SETTINGS;
    },

    async saveSettings(edit) {
      const { version, ...rates } = edit;
      const now = clock.now();
      if (version === 0) return dependable(() => repository.create(rates, now));
      const updated = await dependable(() => repository.update(rates, version, now));
      if (updated === null) throw staleVersion();
      return updated;
    },
  };
}
