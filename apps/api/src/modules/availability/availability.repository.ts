// The only file in this module that imports Mongoose. Returns plain objects, never documents.
import mongoose, { Schema } from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import {
  DAYS_PER_WEEK,
  MAX_ABSENCES,
  MAX_EXCEPTIONS,
  MAX_RANGES_PER_DAY,
  MINUTES_PER_DAY,
  type MinuteRange,
  type Schedule,
  type ScheduleRules,
} from './availability.domain.js';
import type { ScheduleRepository } from './availability.service.js';

/** The schedule is one document with this fixed id (ADR 0024). */
const SCHEDULE_ID = 'schedule';

interface StoredRange {
  startMinute: number;
  endMinute: number;
}
interface StoredSchedule {
  _id: string;
  weekly: { ranges: StoredRange[] }[];
  // A calendar day is stored as UTC midnight (ADR 0011).
  exceptions: { date: Date; ranges: StoredRange[] }[];
  // Documents saved before absences existed have no field: read as [] (ADR 0033, no migration).
  absences?: { from: Date; to: Date }[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const minute = { type: Number, required: true, min: 0, max: MINUTES_PER_DAY };
const rangeSchema = new Schema<StoredRange>(
  { startMinute: minute, endMinute: minute },
  { _id: false },
);
const rangesField = {
  type: [rangeSchema],
  validate: (value: unknown[]) => value.length <= MAX_RANGES_PER_DAY,
};

// Data model: one document in `availability`, never deleted. Embedded because the whole schedule
// is read and replaced together and every array is bounded (7 days, 6 ranges, 60 exceptions).
// The only index is `_id`, whose uniqueness is the singleton guarantee. `versionKey` and
// `timestamps` are off (own integer version, injected clock); `bufferCommands` is off so a call
// fails at once when the database is down.
const scheduleSchema = new Schema<StoredSchedule>(
  {
    _id: { type: String, required: true },
    weekly: {
      type: [new Schema({ ranges: rangesField }, { _id: false })],
      validate: (value: unknown[]) => value.length === DAYS_PER_WEEK,
    },
    exceptions: {
      type: [
        new Schema({ date: { type: Date, required: true }, ranges: rangesField }, { _id: false }),
      ],
      validate: (value: unknown[]) => value.length <= MAX_EXCEPTIONS,
    },
    absences: {
      type: [
        new Schema(
          { from: { type: Date, required: true }, to: { type: Date, required: true } },
          { _id: false },
        ),
      ],
      validate: (value: unknown[]) => value.length <= MAX_ABSENCES,
    },
    version: { type: Number, required: true, min: 1 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'availability', versionKey: false, timestamps: false, bufferCommands: false },
);

const ScheduleModel = mongoose.model<StoredSchedule>('AvailabilitySchedule', scheduleSchema);

const toRanges = (ranges: readonly MinuteRange[]): StoredRange[] =>
  ranges.map(({ startMinute, endMinute }) => ({ startMinute, endMinute }));

function toSchedule(stored: StoredSchedule): Schedule {
  return {
    weekly: stored.weekly.map((day) => ({ ranges: toRanges(day.ranges) })),
    exceptions: stored.exceptions.map(({ date, ranges }) => ({
      date: date.toISOString().slice(0, 10),
      ranges: toRanges(ranges),
    })),
    absences: (stored.absences ?? []).map(({ from, to }) => ({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    })),
    version: stored.version,
    updatedAt: stored.updatedAt,
  };
}

/** The editable fields, copied one by one (never the request object itself). */
function rulesSet(rules: ScheduleRules) {
  return {
    weekly: rules.weekly.map((day) => ({ ranges: toRanges(day.ranges) })),
    exceptions: rules.exceptions.map(({ date, ranges }) => ({
      date: new Date(`${date}T00:00:00.000Z`),
      ranges: toRanges(ranges),
    })),
    absences: rules.absences.map(({ from, to }) => ({
      from: new Date(`${from}T00:00:00.000Z`),
      to: new Date(`${to}T00:00:00.000Z`),
    })),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

const staleVersion = (cause: unknown): AppError =>
  new AppError('conflict', 'The schedule was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
    cause,
  });

/** Driver and Mongoose errors never reach the client: they become a generic 503. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The schedule is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createMongoScheduleRepository(): ScheduleRepository {
  return {
    find() {
      return guarded(async () => {
        const stored = await ScheduleModel.findOne({ _id: SCHEDULE_ID }).lean<StoredSchedule>();
        return stored === null ? null : toSchedule(stored);
      });
    },

    create(rules, now) {
      return guarded(async () => {
        try {
          const created = await ScheduleModel.create({
            _id: SCHEDULE_ID,
            ...rulesSet(rules),
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
          return toSchedule(created.toObject());
        } catch (error) {
          // Someone saved first: the client's "never saved" version is stale.
          throw isDuplicateKey(error) ? staleVersion(error) : error;
        }
      });
    },

    update(rules, version, now) {
      return guarded(async () => {
        const stored = await ScheduleModel.findOneAndUpdate(
          { _id: SCHEDULE_ID, version },
          { $set: { ...rulesSet(rules), updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true },
        ).lean<StoredSchedule>();
        return stored === null ? null : toSchedule(stored);
      });
    },
  };
}
