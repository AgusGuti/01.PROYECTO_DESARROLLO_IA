// The only file in this module that imports Mongoose. Returns plain objects, never documents.
import mongoose, { Schema, type Types } from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import { MATERIALS, type Material } from '../../shared/catalog/materials.js';
import type {
  Filament,
  FilamentListQuery,
  FilamentPage,
  FilamentPatch,
} from './filaments.domain.js';
import type { FilamentRepository } from './filaments.service.js';

/** Case-insensitive, accent-sensitive Spanish comparison, used when sorting by brand. */
const BRAND_COLLATION = { locale: 'es', strength: 2 } as const;

/** Raw shape of a stored document (what `.lean()` returns). */
interface StoredFilament {
  _id: Types.ObjectId;
  brand: string;
  material: Material;
  colorName: string;
  initialGrams: number;
  availableGrams: number;
  purchaseCostMinor: number;
  purchaseDate: Date;
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const wholeNumber = (min: number, max: number) => ({
  type: Number,
  required: true,
  min,
  max,
  validate: { validator: Number.isInteger, message: '{PATH} must be a whole number.' },
});

// Data model: one flat document per spool; nothing is embedded or referenced yet. Later use cases
// (CU03/CU04) will reference a filament by id and copy the cost values they need (a snapshot).
//
// `versionKey` is off: we keep our own integer `version` for optimistic concurrency (ADR 0008).
// `timestamps` is off: the service passes the injected clock's time so tests control dates.
// `bufferCommands` is off: with the database down, a call fails at once instead of waiting.
// The validators repeat the API limits as defence in depth; they are not a database constraint.
const filamentSchema = new Schema(
  {
    brand: { type: String, required: true },
    material: { type: String, enum: MATERIALS, required: true },
    colorName: { type: String, required: true },
    initialGrams: wholeNumber(1, 20_000),
    availableGrams: wholeNumber(0, 20_000),
    purchaseCostMinor: wholeNumber(0, 1_000_000_000),
    // A calendar day stored as UTC midnight (ADR 0011).
    purchaseDate: { type: Date, required: true },
    version: { type: Number, required: true },
    // Written as an explicit null on create so "live" is always `deletedAt: null`.
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'filaments', versionKey: false, timestamps: false, bufferCommands: false },
);

// No secondary indexes on purpose (standard §4.5): the collection holds tens of documents, so a
// scan of `{ deletedAt: null }` is cheap and every write is by `_id`. Revisit when CU04 or CU07
// query by material and stock at a size where it matters. There is no uniqueness rule either:
// two identical spools are legitimate.

const FilamentModel = mongoose.model('Filament', filamentSchema);

function toFilament(stored: StoredFilament): Filament {
  return {
    id: stored._id.toString(),
    brand: stored.brand,
    material: stored.material,
    colorName: stored.colorName,
    initialGrams: stored.initialGrams,
    availableGrams: stored.availableGrams,
    purchaseCostMinor: stored.purchaseCostMinor,
    purchaseDate: stored.purchaseDate,
    version: stored.version,
    deletedAt: stored.deletedAt ?? null,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

/** Driver and Mongoose errors never reach the client: they become a generic 503. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The filament data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createMongoFilamentRepository(): FilamentRepository {
  return {
    create(fields, now) {
      return guarded(async () => {
        const created = await FilamentModel.create({
          brand: fields.brand,
          material: fields.material,
          colorName: fields.colorName,
          initialGrams: fields.initialGrams,
          availableGrams: fields.availableGrams,
          purchaseCostMinor: fields.purchaseCostMinor,
          purchaseDate: fields.purchaseDate,
          version: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        return toFilament(created.toObject<StoredFilament>());
      });
    },

    findLiveById(id) {
      return guarded(async () => {
        const stored = await FilamentModel.findOne({
          _id: id,
          deletedAt: null,
        }).lean<StoredFilament>();
        return stored === null ? null : toFilament(stored);
      });
    },

    list(query: FilamentListQuery): Promise<FilamentPage> {
      return guarded(async () => {
        const filter = {
          deletedAt: null,
          ...(query.material === undefined ? {} : { material: query.material }),
          ...(query.inStock === undefined
            ? {}
            : { availableGrams: query.inStock ? { $gt: 0 } : 0 }),
        };
        const direction = query.order === 'asc' ? 1 : -1;
        // `_id` breaks ties so pages never repeat or skip a filament.
        const find = FilamentModel.find(filter)
          .sort({ [query.sort]: direction, _id: direction })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize);
        if (query.sort === 'brand') find.collation(BRAND_COLLATION);

        // The count uses the same collation as the find, so both always agree on the filter.
        const count = FilamentModel.countDocuments(filter);
        if (query.sort === 'brand') count.collation(BRAND_COLLATION);

        const [items, total] = await Promise.all([find.lean<StoredFilament[]>(), count]);
        return { items: items.map(toFilament), total };
      });
    },

    update(id, version, patch: FilamentPatch, now) {
      return guarded(async () => {
        // Built field by field from a validated patch: client keys never reach `$set`.
        const set: Record<string, unknown> = { updatedAt: now };
        if (patch.brand !== undefined) set['brand'] = patch.brand;
        if (patch.material !== undefined) set['material'] = patch.material;
        if (patch.colorName !== undefined) set['colorName'] = patch.colorName;
        if (patch.initialGrams !== undefined) set['initialGrams'] = patch.initialGrams;
        if (patch.availableGrams !== undefined) set['availableGrams'] = patch.availableGrams;
        if (patch.purchaseCostMinor !== undefined) {
          set['purchaseCostMinor'] = patch.purchaseCostMinor;
        }
        if (patch.purchaseDate !== undefined) set['purchaseDate'] = patch.purchaseDate;

        const stored = await FilamentModel.findOneAndUpdate(
          { _id: id, version, deletedAt: null },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true },
        ).lean<StoredFilament>();
        return stored === null ? null : toFilament(stored);
      });
    },

    softDelete(id, now) {
      return guarded(async () => {
        const stored = await FilamentModel.findOneAndUpdate(
          { _id: id, deletedAt: null },
          { $set: { deletedAt: now, updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after' },
        ).lean<StoredFilament>();
        return stored === null ? null : toFilament(stored);
      });
    },

    consume(id, grams, now) {
      return guarded(async () => {
        // The stock check and the decrement are one atomic write: two requests can never both
        // take the last grams. No version in the filter, so a consume never fails on a stale edit.
        const stored = await FilamentModel.findOneAndUpdate(
          { _id: id, deletedAt: null, availableGrams: { $gte: grams } },
          { $inc: { availableGrams: -grams, version: 1 }, $set: { updatedAt: now } },
          { returnDocument: 'after' },
        ).lean<StoredFilament>();
        return stored === null ? null : toFilament(stored);
      });
    },
  };
}
