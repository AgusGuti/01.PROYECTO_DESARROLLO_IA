// The only file in this module that imports Mongoose. Returns plain objects, never documents.
import mongoose, { Schema, type Types } from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import type { Material } from '../../shared/catalog/materials.js';
import {
  NOZZLE_MATERIALS,
  PRINTER_STATUSES,
  type NozzleDiameterMm,
  type NozzleMaterial,
  type Printer,
  type PrinterFields,
  type PrinterListQuery,
  type PrinterPage,
  type PrinterPatch,
  type PrinterStatus,
} from './printers.domain.js';
import type { PrinterRepository } from './printers.service.js';

/** Case-insensitive, accent-sensitive Spanish comparison. Index and sorts must use the same. */
const NAME_COLLATION = { locale: 'es', strength: 2 } as const;

/** Raw shape of a stored document (what `.lean()` returns). */
interface StoredPrinter {
  _id: Types.ObjectId;
  name: string;
  buildVolume: { x: number; y: number; z: number };
  nozzle: { diameterMm: NozzleDiameterMm; material: NozzleMaterial };
  compatibleMaterials: Material[];
  typicalSpeedMmS?: number | null;
  powerWatts?: number | null;
  status: PrinterStatus;
  version: number;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Data model: one document per printer, everything embedded.
// The build volume, nozzle and material list are small, bounded (at most 14 materials), read
// together with the printer and never shared or changed on their own, so no references are needed.
//
// `versionKey` is off: we keep our own integer `version` for optimistic concurrency (ADR 0008).
// `timestamps` is off: the service passes the injected clock's time so tests control dates.
// `bufferCommands` is off: with the database down, a call fails at once instead of waiting.
const printerSchema = new Schema(
  {
    name: { type: String, required: true },
    buildVolume: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      z: { type: Number, required: true },
    },
    nozzle: {
      diameterMm: { type: Number, required: true },
      material: { type: String, enum: NOZZLE_MATERIALS, required: true },
    },
    compatibleMaterials: { type: [String], required: true },
    // Absent when unset or cleared; the DTO shows null.
    typicalSpeedMmS: { type: Number },
    // Absent when unset or cleared (ADR 0022); the DTO shows null.
    powerWatts: { type: Number, min: 1, max: 5000 },
    status: { type: String, enum: PRINTER_STATUSES, required: true },
    version: { type: Number, required: true },
    // Both are written as an explicit null on create so "live" is always `deletedAt: null`.
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'printers', versionKey: false, timestamps: false, bufferCommands: false },
);

// Purpose: uniqueness of names on every create and rename, and the lookup that restores a deleted
// printer by name. It is not tuned for the list query; at tens of printers that is fine.
// - collation es/strength 2: "Ender 3" and "ENDER 3" are the same name. A sort by name and the
//   restore filter use the same collation so they agree with what the index considers equal.
// - NO partialFilterExpression: deleted and archived printers both keep their name reserved
//   (ADR 0009). A deleted name is reused only through an explicit restore.
printerSchema.index(
  { name: 1 },
  { name: 'printers_name_unique', unique: true, collation: NAME_COLLATION },
);

const PrinterModel = mongoose.model('Printer', printerSchema);

function toPrinter(stored: StoredPrinter): Printer {
  return {
    id: stored._id.toString(),
    name: stored.name,
    buildVolume: { x: stored.buildVolume.x, y: stored.buildVolume.y, z: stored.buildVolume.z },
    nozzle: { diameterMm: stored.nozzle.diameterMm, material: stored.nozzle.material },
    compatibleMaterials: [...stored.compatibleMaterials],
    typicalSpeedMmS: stored.typicalSpeedMmS ?? null,
    powerWatts: stored.powerWatts ?? null,
    status: stored.status,
    version: stored.version,
    archivedAt: stored.archivedAt ?? null,
    deletedAt: stored.deletedAt ?? null,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

/** The user-editable fields, copied one by one (an absent speed stays out of the document). */
function editableSet(fields: PrinterFields) {
  return {
    name: fields.name,
    buildVolume: {
      x: fields.buildVolume.x,
      y: fields.buildVolume.y,
      z: fields.buildVolume.z,
    },
    nozzle: { diameterMm: fields.nozzle.diameterMm, material: fields.nozzle.material },
    compatibleMaterials: [...fields.compatibleMaterials],
    ...(fields.typicalSpeedMmS === null ? {} : { typicalSpeedMmS: fields.typicalSpeedMmS }),
    ...(fields.powerWatts === null ? {} : { powerWatts: fields.powerWatts }),
    status: fields.status,
  };
}

/** Optional fields that are null on a restore must disappear from the revived document. */
function unsetKeys(fields: PrinterFields): Record<string, 1> {
  return {
    ...(fields.typicalSpeedMmS === null ? { typicalSpeedMmS: 1 as const } : {}),
    ...(fields.powerWatts === null ? { powerWatts: 1 as const } : {}),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

const duplicateName = (cause: unknown): AppError =>
  new AppError('conflict', 'A printer with this name already exists.', {
    issues: [{ path: 'name', message: 'Another printer already uses this name.' }],
    cause,
  });

const deletedNameHeld = (cause: unknown): AppError =>
  new AppError('conflict', 'A printer with this name already exists.', {
    issues: [
      {
        path: 'restoreIfDeleted',
        message:
          'A deleted printer with this name exists; resend with restoreIfDeleted true to restore it with the submitted data.',
      },
    ],
    cause,
  });

/** Driver and Mongoose errors never reach the client: they become a generic 503. */
async function guarded<T>(operation: () => Promise<T>, onDuplicate = false): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (onDuplicate && isDuplicateKey(error)) throw duplicateName(error);
    throw new AppError('service_unavailable', 'The printer data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export interface MongoPrinterRepository extends PrinterRepository {
  /**
   * Creates the indexes declared above. Idempotent. In production `autoIndex` is off, so this is
   * run deliberately with `npm run db:indexes` (runbook: database-indexes); in development and
   * tests Mongoose runs the same definition.
   */
  ensureIndexes(): Promise<void>;
  /** True when the unique name index exists. The server refuses to start in production without it. */
  hasUniqueNameIndex(): Promise<boolean>;
}

const COLLECTION_DOES_NOT_EXIST = 26;

// The few properties read from untrusted driver values (index descriptions and errors).
interface DriverValue {
  readonly name?: unknown;
  readonly unique?: unknown;
  readonly code?: unknown;
}

function isRecord(value: unknown): value is DriverValue {
  return typeof value === 'object' && value !== null;
}

export function createMongoPrinterRepository(): MongoPrinterRepository {
  return {
    hasUniqueNameIndex() {
      return guarded(async () => {
        try {
          const indexes: unknown[] = await PrinterModel.collection.listIndexes().toArray();
          return indexes.some(
            (index) =>
              isRecord(index) && index.name === 'printers_name_unique' && index.unique === true,
          );
        } catch (error) {
          if (isRecord(error) && error.code === COLLECTION_DOES_NOT_EXIST) return false;
          throw error;
        }
      });
    },

    ensureIndexes() {
      return guarded(async () => {
        await PrinterModel.createIndexes();
      });
    },

    create(fields, now) {
      return guarded(async () => {
        try {
          const created = await PrinterModel.create({
            ...editableSet(fields),
            version: 1,
            archivedAt: null,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
          });
          return toPrinter(created.toObject<StoredPrinter>());
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          // The index already decided; this read only picks which 409 to answer.
          const holder = await PrinterModel.findOne({ name: fields.name })
            .collation(NAME_COLLATION)
            .select({ deletedAt: 1 })
            .lean<Pick<StoredPrinter, 'deletedAt'>>();
          throw holder?.deletedAt ? deletedNameHeld(error) : duplicateName(error);
        }
      });
    },

    restore(fields, now) {
      return guarded(async () => {
        const stored = await PrinterModel.findOneAndUpdate(
          { name: fields.name, deletedAt: { $ne: null } },
          {
            $set: { ...editableSet(fields), deletedAt: null, archivedAt: null, updatedAt: now },
            ...(Object.keys(unsetKeys(fields)).length === 0 ? {} : { $unset: unsetKeys(fields) }),
            $inc: { version: 1 },
          },
          { returnDocument: 'after', runValidators: true, collation: NAME_COLLATION },
        ).lean<StoredPrinter>();
        return stored === null ? null : toPrinter(stored);
      });
    },

    unarchive(id, now) {
      return guarded(async () => {
        const stored = await PrinterModel.findOneAndUpdate(
          { _id: id, deletedAt: null, archivedAt: { $ne: null } },
          { $set: { archivedAt: null, updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after' },
        ).lean<StoredPrinter>();
        return stored === null ? null : toPrinter(stored);
      });
    },

    findLiveById(id) {
      return guarded(async () => {
        const stored = await PrinterModel.findOne({
          _id: id,
          deletedAt: null,
        }).lean<StoredPrinter>();
        return stored === null ? null : toPrinter(stored);
      });
    },

    list(query: PrinterListQuery): Promise<PrinterPage> {
      return guarded(async () => {
        // Archived printers are listed and counted; only deleted ones are excluded.
        const filter = {
          deletedAt: null,
          ...(query.status === undefined ? {} : { status: query.status }),
        };
        const direction = query.order === 'asc' ? 1 : -1;
        // `_id` breaks ties so pages never repeat or skip a printer.
        const find = PrinterModel.find(filter)
          .sort({ [query.sort]: direction, _id: direction })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize);
        if (query.sort === 'name') find.collation(NAME_COLLATION);

        const [items, total] = await Promise.all([
          find.lean<StoredPrinter[]>(),
          PrinterModel.countDocuments(filter),
        ]);
        return { items: items.map(toPrinter), total };
      });
    },

    update(id, version, patch: PrinterPatch, now) {
      return guarded(async () => {
        // Built field by field from a validated patch: client keys never reach `$set`.
        const set: Record<string, unknown> = { updatedAt: now };
        if (patch.name !== undefined) set['name'] = patch.name;
        if (patch.buildVolume !== undefined) {
          set['buildVolume'] = {
            x: patch.buildVolume.x,
            y: patch.buildVolume.y,
            z: patch.buildVolume.z,
          };
        }
        if (patch.nozzle !== undefined) {
          set['nozzle'] = { diameterMm: patch.nozzle.diameterMm, material: patch.nozzle.material };
        }
        if (patch.compatibleMaterials !== undefined) {
          set['compatibleMaterials'] = [...patch.compatibleMaterials];
        }
        if (typeof patch.typicalSpeedMmS === 'number') {
          set['typicalSpeedMmS'] = patch.typicalSpeedMmS;
        }
        if (typeof patch.powerWatts === 'number') set['powerWatts'] = patch.powerWatts;
        if (patch.status !== undefined) set['status'] = patch.status;
        const unset: Record<string, 1> = {};
        if (patch.typicalSpeedMmS === null) unset['typicalSpeedMmS'] = 1;
        if (patch.powerWatts === null) unset['powerWatts'] = 1;

        const stored = await PrinterModel.findOneAndUpdate(
          { _id: id, version, deletedAt: null },
          {
            $set: set,
            ...(Object.keys(unset).length === 0 ? {} : { $unset: unset }),
            $inc: { version: 1 },
          },
          { returnDocument: 'after', runValidators: true },
        ).lean<StoredPrinter>();
        return stored === null ? null : toPrinter(stored);
      }, true);
    },

    archive(id, now) {
      return guarded(async () => {
        const stored = await PrinterModel.findOneAndUpdate(
          { _id: id, deletedAt: null, archivedAt: null },
          { $set: { archivedAt: now, updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after' },
        ).lean<StoredPrinter>();
        return stored === null ? null : toPrinter(stored);
      });
    },

    softDelete(id, now) {
      return guarded(async () => {
        const stored = await PrinterModel.findOneAndUpdate(
          { _id: id, deletedAt: null, archivedAt: null, status: { $ne: 'in_use' } },
          { $set: { deletedAt: now, updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after' },
        ).lean<StoredPrinter>();
        return stored === null ? null : toPrinter(stored);
      });
    },
  };
}
