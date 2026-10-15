// The only file in this module that imports Mongoose. Returns plain objects, never documents.
import mongoose, { Schema, type PipelineStage, type Types } from 'mongoose';
import { AppError } from '../../shared/errors/app-error.js';
import {
  PRIORITIES,
  type Priority,
  type Project,
  type ProjectListQuery,
  type ProjectPage,
  type ProjectPatch,
  type ProjectSort,
} from './projects.domain.js';
import type { ProjectRepository } from './projects.service.js';

/** Case-insensitive, accent-sensitive Spanish comparison, used when sorting by name. */
const NAME_COLLATION = { locale: 'es', strength: 2 } as const;

/** Raw shape of a stored document (what `.lean()` and `aggregate` return). */
interface StoredProject {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  priority: Priority;
  deadline: Date | null;
  items: { partId: Types.ObjectId; quantity: number }[];
  version: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Data model (ADR 0016): one document per project. The lines are embedded because they are
// bounded (100), always read with the project and have no lifecycle of their own. A line
// REFERENCES the part by id and never copies its values; the detail reads the part's current
// data through the lookup port. A confirmed quote or queue entry will snapshot instead (CU04/07).
//
// `versionKey` is off: we keep our own integer `version` for optimistic concurrency (ADR 0008).
// `timestamps` is off: the service passes the injected clock's time so tests control dates.
// `bufferCommands` is off: with the database down, a call fails at once instead of waiting.
// The validators repeat the API limits as defence in depth; they are not a database constraint.
const itemSchema = new Schema(
  {
    partId: { type: Schema.Types.ObjectId, required: true },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 1000,
      validate: { validator: Number.isInteger, message: '{PATH} must be a whole number.' },
    },
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    priority: { type: String, enum: PRIORITIES, required: true },
    deadline: { type: Date, default: null },
    items: { type: [itemSchema], default: [], validate: (value: unknown[]) => value.length <= 100 },
    version: { type: Number, required: true },
    // Written as an explicit null on create so "live" is always `deletedAt: null`.
    deletedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'projects', versionKey: false, timestamps: false, bufferCommands: false },
);

// No secondary indexes on purpose (standard §4.5, ADR 0016): the list sorts on a computed key
// and the collection holds tens to hundreds of documents, so a scan of the live ones is cheap.
// A multikey index on `items.partId` waits for an `explain` that shows a real cost.

const ProjectModel = mongoose.model('Project', projectSchema);

function toProject(stored: StoredProject): Project {
  return {
    id: stored._id.toString(),
    name: stored.name,
    description: stored.description ?? null,
    priority: stored.priority,
    deadline: stored.deadline ?? null,
    items: stored.items.map((item) => ({
      partId: item.partId.toString(),
      quantity: item.quantity,
    })),
    version: stored.version,
    deletedAt: stored.deletedAt ?? null,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

const storedItems = (items: Project['items']) =>
  items.map((item) => ({
    partId: new mongoose.Types.ObjectId(item.partId),
    quantity: item.quantity,
  }));

type Direction = 1 | -1;

// Sort keys come from this table, never from the client string. Each ends with `_id` in the same
// direction so pages never repeat or skip a project. Without a deadline comes last in both
// directions because `noDeadline` is always ascending.
const SORT_KEYS: Record<ProjectSort, (direction: Direction) => Record<string, Direction>> = {
  priority: (d) => ({ priorityRank: d, _id: d }),
  name: (d) => ({ name: d, _id: d }),
  createdAt: (d) => ({ createdAt: d, _id: d }),
  deadline: (d) => ({ noDeadline: 1, deadline: d, _id: d }),
};

/** Driver and Mongoose errors never reach the client: they become a generic 503. */
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The project data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createMongoProjectRepository(): ProjectRepository {
  return {
    create(fields, now) {
      return guarded(async () => {
        const created = await ProjectModel.create({
          name: fields.name,
          description: fields.description,
          priority: fields.priority,
          deadline: fields.deadline,
          items: storedItems(fields.items),
          version: 1,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        return toProject(created.toObject<StoredProject>());
      });
    },

    findLiveById(id) {
      return guarded(async () => {
        const stored = await ProjectModel.findOne({
          _id: id,
          deletedAt: null,
        }).lean<StoredProject>();
        return stored === null ? null : toProject(stored);
      });
    },

    list(query: ProjectListQuery): Promise<ProjectPage> {
      return guarded(async () => {
        const filter = {
          deletedAt: null,
          ...(query.priority === undefined ? {} : { priority: query.priority }),
        };
        const direction: Direction = query.order === 'asc' ? 1 : -1;
        const pipeline: PipelineStage[] = [
          { $match: filter },
          {
            $addFields: {
              // Position in the priority list: low 0 .. urgent 3. Derived, never stored.
              priorityRank: { $indexOfArray: [[...PRIORITIES], '$priority'] },
              noDeadline: { $cond: [{ $eq: [{ $ifNull: ['$deadline', null] }, null] }, 1, 0] },
            },
          },
          { $sort: SORT_KEYS[query.sort](direction) },
          { $skip: (query.page - 1) * query.pageSize },
          { $limit: query.pageSize },
        ];
        const aggregate = ProjectModel.aggregate<StoredProject>(pipeline);
        // The count uses the same collation as the aggregation, so both agree on the filter.
        const count = ProjectModel.countDocuments(filter);
        if (query.sort === 'name') {
          aggregate.collation(NAME_COLLATION);
          count.collation(NAME_COLLATION);
        }

        const [items, total] = await Promise.all([aggregate, count]);
        return { items: items.map(toProject), total };
      });
    },

    update(id, version, patch: ProjectPatch, now) {
      return guarded(async () => {
        // Built field by field from a validated patch: client keys never reach `$set`.
        const set: Record<string, unknown> = { updatedAt: now };
        if (patch.name !== undefined) set['name'] = patch.name;
        if (patch.description !== undefined) set['description'] = patch.description;
        if (patch.priority !== undefined) set['priority'] = patch.priority;
        if (patch.deadline !== undefined) set['deadline'] = patch.deadline;
        if (patch.items !== undefined) set['items'] = storedItems(patch.items);

        const stored = await ProjectModel.findOneAndUpdate(
          { _id: id, version, deletedAt: null },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after', runValidators: true },
        ).lean<StoredProject>();
        return stored === null ? null : toProject(stored);
      });
    },

    softDelete(id, now) {
      return guarded(async () => {
        const stored = await ProjectModel.findOneAndUpdate(
          { _id: id, deletedAt: null },
          { $set: { deletedAt: now, updatedAt: now }, $inc: { version: 1 } },
          { returnDocument: 'after' },
        ).lean<StoredProject>();
        return stored === null ? null : toProject(stored);
      });
    },

    usageOfPart(partId, limit) {
      return guarded(async () => {
        const wanted = new mongoose.Types.ObjectId(partId);
        const filter = { deletedAt: null, 'items.partId': wanted };
        const [found, total] = await Promise.all([
          ProjectModel.find(filter)
            .select({ name: 1, items: 1 })
            .sort({ name: 1, _id: 1 })
            .collation(NAME_COLLATION)
            .limit(limit)
            .lean<Pick<StoredProject, '_id' | 'name' | 'items'>[]>(),
          ProjectModel.countDocuments(filter),
        ]);
        return {
          total,
          projects: found.map((stored) => ({
            id: stored._id.toString(),
            name: stored.name,
            quantity: stored.items.find((item) => item.partId.equals(wanted))?.quantity ?? 0,
          })),
        };
      });
    },

    pullPart(partId, now) {
      return guarded(async () => {
        const wanted = new mongoose.Types.ObjectId(partId);
        // One write for all live projects. Repeating it finds nothing left to pull.
        const result = await ProjectModel.updateMany(
          { deletedAt: null, 'items.partId': wanted },
          {
            $pull: { items: { partId: wanted } },
            $inc: { version: 1 },
            $set: { updatedAt: now },
          },
        );
        return result.modifiedCount;
      });
    },
  };
}
