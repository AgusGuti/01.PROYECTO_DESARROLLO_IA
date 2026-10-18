// The only file in this module that imports Mongoose. Returns plain objects, never documents.
import mongoose, { Schema } from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import {
  GOALS,
  MAX_LINES,
  MAX_PRINTERS,
  MAX_QUANTITY,
  MODES,
  type Goal,
  type Mode,
  type Queue,
  type QueueLine,
  type QueuePatch,
} from './queues.domain.js';
import type { QueueRepository } from './queues.service.js';

interface StoredQueue {
  _id: string;
  goal: Goal;
  mode: Mode;
  printerIds: string[];
  lines: QueueLine[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// Data model (ADR 0025): one document per project whose _id IS the project id, so "at most one
// queue per project" is the unique _id index, not a lookup. Lines are embedded (bounded to 100,
// always read together) and are a SNAPSHOT of the project's items that the user edits: they are
// not synced with later project edits. Parts and printers are referenced by id only.
// `versionKey` and `timestamps` are off (own integer version, injected clock); `bufferCommands`
// is off so a call fails at once when the database is down. The validators repeat the API limits
// as defence in depth.
const wholeNumber = { validator: Number.isInteger, message: '{PATH} must be a whole number.' };
const lineSchema = new Schema<QueueLine>(
  {
    partId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, max: MAX_QUANTITY, validate: wholeNumber },
    completed: { type: Number, required: true, min: 0, max: MAX_QUANTITY, validate: wholeNumber },
  },
  { _id: false },
);

const queueSchema = new Schema<StoredQueue>(
  {
    _id: { type: String, required: true },
    goal: { type: String, enum: GOALS, required: true },
    mode: { type: String, enum: MODES, required: true },
    printerIds: {
      type: [String],
      validate: (value: unknown[]) => value.length >= 1 && value.length <= MAX_PRINTERS,
    },
    lines: { type: [lineSchema], validate: (value: unknown[]) => value.length <= MAX_LINES },
    version: { type: Number, required: true, min: 1 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'queues', versionKey: false, timestamps: false, bufferCommands: false },
);

// Index (ADR 0032). Purpose: "is this printer in a queue with pending work?", asked on every
// printer removal. A multikey index on the array makes the lookup by printer id an IXSCAN
// instead of reading every queue. Non-unique: many queues may share a printer.
queueSchema.index({ printerIds: 1 }, { name: 'queues_printer_ids' });

const QueueModel = mongoose.model<StoredQueue>('Queue', queueSchema);

const toLines = (lines: readonly QueueLine[]): QueueLine[] =>
  lines.map(({ partId, quantity, completed }) => ({ partId, quantity, completed }));

function toQueue(stored: StoredQueue): Queue {
  return {
    id: stored._id,
    goal: stored.goal,
    mode: stored.mode,
    printerIds: [...stored.printerIds],
    lines: toLines(stored.lines),
    version: stored.version,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/** Driver and Mongoose errors never reach the client: they become a generic 503. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The queue data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export interface MongoQueueRepository extends QueueRepository {
  /** Creates the indexes declared above. Idempotent; run by `npm run db:indexes` in production. */
  ensureIndexes(): Promise<void>;
}

export function createMongoQueueRepository(): MongoQueueRepository {
  return {
    ensureIndexes() {
      return guarded(async () => {
        await QueueModel.createIndexes();
      });
    },

    hasPendingWorkFor(printerId) {
      return guarded(async () => {
        // The equality on `printerIds` uses the index; `$expr` then checks the (at most 100)
        // embedded lines of the few queues that match: any line with completed < quantity.
        const filter: Record<string, unknown> = {
          printerIds: printerId,
          $expr: {
            $anyElementTrue: {
              $map: {
                input: '$lines',
                as: 'line',
                in: { $lt: ['$$line.completed', '$$line.quantity'] },
              },
            },
          },
        };
        const found = await QueueModel.exists(filter);
        return found !== null;
      });
    },

    create(id, fields, now) {
      return guarded(async () => {
        try {
          const created = await QueueModel.create({
            _id: id,
            goal: fields.goal,
            mode: fields.mode,
            printerIds: [...fields.printerIds],
            lines: toLines(fields.lines),
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
          return toQueue(created.toObject());
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          throw new AppError('conflict', 'The project already has a queue.', {
            issues: [{ path: 'projectId', message: 'The project already has a queue.' }],
            cause: error,
          });
        }
      });
    },

    findById(id) {
      return guarded(async () => {
        const stored = await QueueModel.findOne({ _id: id }).lean<StoredQueue>();
        return stored === null ? null : toQueue(stored);
      });
    },

    update(id, version, patch: QueuePatch, now) {
      return guarded(async () => {
        // Built field by field from a validated patch: client keys never reach `$set`.
        const set: Record<string, unknown> = { updatedAt: now };
        if (patch.goal !== undefined) set['goal'] = patch.goal;
        if (patch.mode !== undefined) set['mode'] = patch.mode;
        if (patch.printerIds !== undefined) set['printerIds'] = [...patch.printerIds];
        if (patch.lines !== undefined) set['lines'] = toLines(patch.lines);

        const stored = await QueueModel.findOneAndUpdate(
          { _id: id, version },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true },
        ).lean<StoredQueue>();
        return stored === null ? null : toQueue(stored);
      });
    },

    remove(id, version) {
      return guarded(async () => {
        const result = await QueueModel.deleteOne({ _id: id, version });
        return result.deletedCount === 1;
      });
    },
  };
}
