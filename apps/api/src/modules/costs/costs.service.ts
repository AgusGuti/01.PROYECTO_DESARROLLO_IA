// Use cases for costs (CU03). Knows nothing about HTTP or MongoDB: it talks to a settings
// repository and to three read ports owned here (ADR 0017), plus the injected clock.
import { AppError, type FieldIssue } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import {
  calculateEstimate,
  DEFAULT_COST_SETTINGS,
  type CostRates,
  type CostSettings,
  type Estimate,
  type FilamentCostData,
  type PartCostData,
  type PrinterCostData,
} from './costs.domain.js';

/** Ports owned by this module. `null` means unknown or deleted; a rejection is a failure. */
export type PartReader = (id: string) => Promise<PartCostData | null>;
export type FilamentReader = (id: string) => Promise<FilamentCostData | null>;
/** An archived (pending removal) printer is still found; a deleted one is not. */
export type PrinterReader = (id: string) => Promise<PrinterCostData | null>;

export interface CostSettingsRepository {
  /** The settings document, or null when never saved. Never writes. */
  find(): Promise<CostSettings | null>;
  /** First save. @throws AppError `conflict` (issue path `version`) when a document exists. */
  create(rates: CostRates, now: Date): Promise<CostSettings>;
  /** One atomic write guarded by the version; `null` when the version is stale. */
  update(rates: CostRates, version: number, now: Date): Promise<CostSettings | null>;
}

export interface NewEstimate {
  readonly partId: string;
  readonly filamentId: string;
  readonly printerId?: string | undefined;
  readonly quantity: number;
  readonly marginBasisPoints?: number | undefined;
}

export interface SettingsEdit extends CostRates {
  readonly version: number;
}

export interface CostsService {
  estimate(input: NewEstimate): Promise<Estimate>;
  getSettings(): Promise<CostSettings>;
  saveSettings(edit: SettingsEdit): Promise<CostSettings>;
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
    throw new AppError('service_unavailable', 'The cost data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createCostsService(deps: {
  repository: CostSettingsRepository;
  partReader: PartReader;
  filamentReader: FilamentReader;
  printerReader: PrinterReader;
  clock: Clock;
}): CostsService {
  const { repository, clock } = deps;

  const readSettings = async (): Promise<CostSettings> =>
    (await dependable(() => repository.find())) ?? DEFAULT_COST_SETTINGS;

  return {
    async estimate(input) {
      const { printerId } = input;
      // Independent reads, not a transaction: the estimate is advisory and stored nowhere.
      const [part, filament, printer, settings] = await Promise.all([
        dependable(() => deps.partReader(input.partId)),
        dependable(() => deps.filamentReader(input.filamentId)),
        printerId === undefined
          ? Promise.resolve(null)
          : dependable(() => deps.printerReader(printerId)),
        readSettings(),
      ]);

      const issues: FieldIssue[] = [];
      if (part === null) issues.push({ path: 'partId', message: 'The part does not exist.' });
      if (filament === null) {
        issues.push({ path: 'filamentId', message: 'The spool does not exist.' });
      }
      if (printerId !== undefined && printer === null) {
        issues.push({ path: 'printerId', message: 'The printer does not exist.' });
      }
      if (part !== null && filament !== null && part.material !== filament.material) {
        issues.push({
          path: 'filamentId',
          message: 'The spool material differs from the part material.',
        });
      }
      if (issues.length > 0 || part === null || filament === null) {
        throw new AppError('validation_failed', 'The request is not valid.', { issues });
      }

      const result = calculateEstimate({
        part,
        filament,
        printer,
        quantity: input.quantity,
        marginBasisPoints: input.marginBasisPoints ?? 0,
        settings,
      });
      if (!result.ok) {
        throw new AppError('validation_failed', 'The request is not valid.', {
          issues: [{ path: 'quantity', message: 'The amounts are too large for this quantity.' }],
        });
      }
      return result.estimate;
    },

    getSettings: readSettings,

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
