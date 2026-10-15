// Test doubles for the costs module: plain-object in-memory settings repository, fake read ports
// and a movable clock. The real repository has its own integration tests.
import { AppError } from '../../../shared/errors/app-error.js';
import type { Clock } from '../../health/index.js';
import type {
  CostRates,
  CostSettings,
  FilamentCostData,
  PartCostData,
  PrinterCostData,
} from '../costs.domain.js';
import type { CostSettingsRepository } from '../costs.service.js';

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

/** Ids used in tests: 24 hex characters. */
export const PART_ID = 'a'.repeat(24);
export const FILAMENT_ID = 'b'.repeat(24);
export const PRINTER_ID = 'c'.repeat(24);
export const OTHER_ID = 'd'.repeat(24);

export const validRates: CostRates = {
  kwhPriceMinor: 8000,
  wearPerHourMinor: 150,
  fixedPerJobMinor: 5000,
  defaultMarginBasisPoints: 2500,
};

export const partData: PartCostData = {
  id: PART_ID,
  material: 'PETG',
  estimatedWeightGrams: 100,
  estimatedPrintSeconds: 7200,
};

export const filamentData: FilamentCostData = {
  id: FILAMENT_ID,
  material: 'PETG',
  initialGrams: 1000,
  availableGrams: 1000,
  purchaseCostMinor: 2_000_000,
};

export const printerData: PrinterCostData = { id: PRINTER_ID, powerWatts: 270 };

export interface FakeReader<T> {
  readonly read: (id: string) => Promise<T | null>;
  /** The ids asked, in order. */
  readonly calls: string[];
  /** The records that exist. Anything else is unknown or deleted. */
  readonly records: Map<string, T>;
  /** When set, the reader rejects with this error (a dependency failure). */
  failWith: Error | undefined;
}

export function createFakeReader<T>(initial: readonly (readonly [string, T])[]): FakeReader<T> {
  const fake: FakeReader<T> = {
    calls: [],
    records: new Map(initial),
    failWith: undefined,
    read(id) {
      fake.calls.push(id);
      if (fake.failWith !== undefined) return Promise.reject(fake.failWith);
      return Promise.resolve(fake.records.get(id) ?? null);
    },
  };
  return fake;
}

export interface FakeSettingsRepository extends CostSettingsRepository {
  /** Names of the repository methods called, in order. */
  readonly calls: string[];
  /** The stored document, or null when never saved. */
  stored: CostSettings | null;
  /** When set, every method rejects with this error (a dependency failure). */
  failWith: Error | undefined;
}

export function createFakeSettingsRepository(): FakeSettingsRepository {
  const guard = (name: string): void => {
    repository.calls.push(name);
    if (repository.failWith !== undefined) throw repository.failWith;
  };

  const repository: FakeSettingsRepository = {
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

/** A complete set of fakes with one part, one spool and one printer already stored. */
export function createFakes() {
  return {
    settings: createFakeSettingsRepository(),
    parts: createFakeReader<PartCostData>([[PART_ID, partData]]),
    filaments: createFakeReader<FilamentCostData>([[FILAMENT_ID, filamentData]]),
    printers: createFakeReader<PrinterCostData>([[PRINTER_ID, printerData]]),
  };
}
