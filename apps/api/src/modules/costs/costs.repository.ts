// The only file in this module that imports Mongoose. Returns plain objects, never documents.
import mongoose, { Schema } from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import type { CostRates, CostSettings } from './costs.domain.js';
import type { CostSettingsRepository } from './costs.service.js';

/** The settings are one document with this fixed id (ADR 0021). */
const SETTINGS_ID = 'costs';

/** Raw shape of the stored document (what `.lean()` returns). */
interface StoredSettings {
  _id: string;
  kwhPriceMinor: number;
  wearPerHourMinor: number;
  fixedPerJobMinor: number;
  defaultMarginBasisPoints: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const money = { type: Number, required: true, min: 0, max: 1_000_000_000 };

// Data model: one flat document in `settings`, never deleted. The only index is `_id`, whose
// uniqueness is the singleton guarantee, even for two simultaneous first saves.
// `versionKey` and `timestamps` are off (own integer version, injected clock); `bufferCommands`
// is off so a call fails at once when the database is down.
const settingsSchema = new Schema<StoredSettings>(
  {
    _id: { type: String, required: true },
    kwhPriceMinor: money,
    wearPerHourMinor: money,
    fixedPerJobMinor: money,
    defaultMarginBasisPoints: { type: Number, required: true, min: 0, max: 100_000 },
    version: { type: Number, required: true, min: 1 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'settings', versionKey: false, timestamps: false, bufferCommands: false },
);

const SettingsModel = mongoose.model<StoredSettings>('CostSettings', settingsSchema);

function toSettings(stored: StoredSettings): CostSettings {
  return {
    kwhPriceMinor: stored.kwhPriceMinor,
    wearPerHourMinor: stored.wearPerHourMinor,
    fixedPerJobMinor: stored.fixedPerJobMinor,
    defaultMarginBasisPoints: stored.defaultMarginBasisPoints,
    version: stored.version,
    updatedAt: stored.updatedAt,
  };
}

/** The four editable numbers, copied one by one (never the request object itself). */
function ratesSet(rates: CostRates): CostRates {
  return {
    kwhPriceMinor: rates.kwhPriceMinor,
    wearPerHourMinor: rates.wearPerHourMinor,
    fixedPerJobMinor: rates.fixedPerJobMinor,
    defaultMarginBasisPoints: rates.defaultMarginBasisPoints,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

const staleVersion = (cause: unknown): AppError =>
  new AppError('conflict', 'The settings were changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
    cause,
  });

/** Driver and Mongoose errors never reach the client: they become a generic 503. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The cost settings are temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createMongoCostSettingsRepository(): CostSettingsRepository {
  return {
    find() {
      return guarded(async () => {
        const stored = await SettingsModel.findOne({ _id: SETTINGS_ID }).lean<StoredSettings>();
        return stored === null ? null : toSettings(stored);
      });
    },

    create(rates, now) {
      return guarded(async () => {
        try {
          const created = await SettingsModel.create({
            _id: SETTINGS_ID,
            ...ratesSet(rates),
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
          return toSettings(created.toObject());
        } catch (error) {
          // Someone saved first: the client's "never saved" version is stale.
          throw isDuplicateKey(error) ? staleVersion(error) : error;
        }
      });
    },

    update(rates, version, now) {
      return guarded(async () => {
        const stored = await SettingsModel.findOneAndUpdate(
          { _id: SETTINGS_ID, version },
          { $set: { ...ratesSet(rates), updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true },
        ).lean<StoredSettings>();
        return stored === null ? null : toSettings(stored);
      });
    },
  };
}
