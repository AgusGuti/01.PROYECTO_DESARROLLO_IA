// The only file in this module that imports Mongoose. Returns plain objects, never documents.
import mongoose, { Schema, type Types } from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import { MATERIALS, type Material } from '../../shared/catalog/materials.js';
import type { Part, PartListQuery, PartPage, PartPatch, PartSource } from './parts.domain.js';
import type { LivePartSummary, PartRepository } from './parts.service.js';

/** Case-insensitive, accent-sensitive Spanish comparison, used when sorting by name. */
const NAME_COLLATION = { locale: 'es', strength: 2 } as const;

/** Raw shape of a stored document (what `.lean()` returns). */
interface StoredPart {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  material: Material;
  dimensionsMm: { x: number; y: number; z: number };
  estimatedWeightGrams: number;
  estimatedPrintSeconds: number;
  layerHeightUm: number;
  suggestedPrinterName: string | null;
  source:
    { kind: 'manual' } | { kind: 'gcode'; fileName: string; slicer: 'cura'; analyzedAt: Date };
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

// Data model: one flat document per part. `dimensionsMm` and `source` are embedded because they
// are small, bounded and always read together; nothing is referenced (ADR 0013). CU01 will
// reference a part by id, and CU01/CU03 will copy the values they use (a snapshot).
//
// `versionKey` is off: we keep our own integer `version` for optimistic concurrency (ADR 0008).
// `timestamps` is off: the service passes the injected clock's time so tests control dates.
// `bufferCommands` is off: with the database down, a call fails at once instead of waiting.
// The validators repeat the API limits as defence in depth; they are not a database constraint.
const sourceSchema = new Schema(
  {
    kind: { type: String, enum: ['manual', 'gcode'], required: true },
    fileName: { type: String },
    slicer: { type: String, enum: ['cura'] },
    analyzedAt: { type: Date },
  },
  { _id: false },
);

const partSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    material: { type: String, enum: MATERIALS, required: true },
    dimensionsMm: {
      type: new Schema(
        { x: wholeNumber(1, 1000), y: wholeNumber(1, 1000), z: wholeNumber(1, 1000) },
        { _id: false },
      ),
      required: true,
    },
    estimatedWeightGrams: wholeNumber(1, 20_000),
    estimatedPrintSeconds: wholeNumber(1, 2_592_000),
    layerHeightUm: wholeNumber(10, 2000),
    suggestedPrinterName: { type: String, default: null },
    source: { type: sourceSchema, required: true },
    version: { type: Number, required: true },
    // Written as an explicit null on create so "live" is always `deletedAt: null`.
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'parts', versionKey: false, timestamps: false, bufferCommands: false },
);

// No secondary indexes on purpose (standard §4.5, ADR 0013): the collection holds tens to
// hundreds of documents, so a scan of `{ deletedAt: null }` is cheap and every write is by `_id`.
// There is no uniqueness rule either: two parts may share a name.

const PartModel = mongoose.model('Part', partSchema);

function toSource(stored: StoredPart['source']): PartSource {
  if (stored.kind === 'manual') return { kind: 'manual' };
  return {
    kind: 'gcode',
    fileName: stored.fileName,
    slicer: stored.slicer,
    analyzedAt: stored.analyzedAt,
  };
}

function toPart(stored: StoredPart): Part {
  return {
    id: stored._id.toString(),
    name: stored.name,
    description: stored.description ?? null,
    material: stored.material,
    dimensionsMm: {
      x: stored.dimensionsMm.x,
      y: stored.dimensionsMm.y,
      z: stored.dimensionsMm.z,
    },
    estimatedWeightGrams: stored.estimatedWeightGrams,
    estimatedPrintSeconds: stored.estimatedPrintSeconds,
    layerHeightUm: stored.layerHeightUm,
    suggestedPrinterName: stored.suggestedPrinterName ?? null,
    source: toSource(stored.source),
    version: stored.version,
    deletedAt: stored.deletedAt ?? null,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

/** The stored form of a source: only the fields of its kind, so nothing else can be persisted. */
function sourceDocument(source: PartSource): StoredPart['source'] {
  if (source.kind === 'manual') return { kind: 'manual' };
  return {
    kind: 'gcode',
    fileName: source.fileName,
    slicer: source.slicer,
    analyzedAt: source.analyzedAt,
  };
}

/** Driver and Mongoose errors never reach the client: they become a generic 503. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The part data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createMongoPartRepository(): PartRepository {
  return {
    create(fields, now) {
      return guarded(async () => {
        const created = await PartModel.create({
          name: fields.name,
          description: fields.description,
          material: fields.material,
          dimensionsMm: {
            x: fields.dimensionsMm.x,
            y: fields.dimensionsMm.y,
            z: fields.dimensionsMm.z,
          },
          estimatedWeightGrams: fields.estimatedWeightGrams,
          estimatedPrintSeconds: fields.estimatedPrintSeconds,
          layerHeightUm: fields.layerHeightUm,
          suggestedPrinterName: fields.suggestedPrinterName,
          source: sourceDocument(fields.source),
          version: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        return toPart(created.toObject<StoredPart>());
      });
    },

    findLiveById(id) {
      return guarded(async () => {
        const stored = await PartModel.findOne({ _id: id, deletedAt: null }).lean<StoredPart>();
        return stored === null ? null : toPart(stored);
      });
    },

    findLiveByIds(ids) {
      return guarded(async () => {
        if (ids.length === 0) return [];
        const found = await PartModel.find({ _id: { $in: [...ids] }, deletedAt: null })
          .select({ name: 1, material: 1 })
          .lean<Pick<StoredPart, '_id' | 'name' | 'material'>[]>();
        return found.map((stored): LivePartSummary => ({
          id: stored._id.toString(),
          name: stored.name,
          material: stored.material,
        }));
      });
    },

    list(query: PartListQuery): Promise<PartPage> {
      return guarded(async () => {
        const filter = {
          deletedAt: null,
          ...(query.material === undefined ? {} : { material: query.material }),
        };
        const direction = query.order === 'asc' ? 1 : -1;
        // `_id` breaks ties so pages never repeat or skip a part.
        // No projection: a part is a small flat document and the whole of it is the answer.
        const find = PartModel.find(filter)
          .sort({ [query.sort]: direction, _id: direction })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize);
        if (query.sort === 'name') find.collation(NAME_COLLATION);

        // The count uses the same collation as the find, so both always agree on the filter.
        const count = PartModel.countDocuments(filter);
        if (query.sort === 'name') count.collation(NAME_COLLATION);

        const [items, total] = await Promise.all([find.lean<StoredPart[]>(), count]);
        return { items: items.map(toPart), total };
      });
    },

    update(id, version, patch: PartPatch, now) {
      return guarded(async () => {
        // Built field by field from a validated patch: client keys never reach `$set`.
        const set: Record<string, unknown> = { updatedAt: now };
        if (patch.name !== undefined) set['name'] = patch.name;
        if (patch.description !== undefined) set['description'] = patch.description;
        if (patch.material !== undefined) set['material'] = patch.material;
        if (patch.dimensionsMm !== undefined) {
          set['dimensionsMm'] = {
            x: patch.dimensionsMm.x,
            y: patch.dimensionsMm.y,
            z: patch.dimensionsMm.z,
          };
        }
        if (patch.estimatedWeightGrams !== undefined) {
          set['estimatedWeightGrams'] = patch.estimatedWeightGrams;
        }
        if (patch.estimatedPrintSeconds !== undefined) {
          set['estimatedPrintSeconds'] = patch.estimatedPrintSeconds;
        }
        if (patch.layerHeightUm !== undefined) set['layerHeightUm'] = patch.layerHeightUm;
        if (patch.suggestedPrinterName !== undefined) {
          set['suggestedPrinterName'] = patch.suggestedPrinterName;
        }
        if (patch.source !== undefined) set['source'] = sourceDocument(patch.source);

        const stored = await PartModel.findOneAndUpdate(
          { _id: id, version, deletedAt: null },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true },
        ).lean<StoredPart>();
        return stored === null ? null : toPart(stored);
      });
    },

    softDelete(id, now) {
      return guarded(async () => {
        const stored = await PartModel.findOneAndUpdate(
          { _id: id, deletedAt: null },
          { $set: { deletedAt: now, updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after' },
        ).lean<StoredPart>();
        return stored === null ? null : toPart(stored);
      });
    },
  };
}
