// Use cases for the print queue (CU07). Knows nothing about HTTP or MongoDB: it talks to a
// repository interface, to three read ports owned here (ADR 0017) and to the injected clock.
import { AppError, type FieldIssue } from '../../shared/errors/app-error.js';
import type { Clock } from '../health/index.js';
import {
  lineIssues,
  printerSelectionIssues,
  queueTotals,
  type Goal,
  type Mode,
  type PartInfo,
  type Queue,
  type QueueDetail,
  type QueueFields,
  type QueueLine,
  type QueuePatch,
} from './queues.domain.js';

/**
 * Persistence port. A queue's id is the id of its project. Writes that can match nothing return
 * `null` or `false`; the service decides what that means.
 */
export interface QueueRepository {
  /** @throws AppError `conflict` (issue path `projectId`) when the project already has a queue. */
  create(id: string, fields: QueueFields, now: Date): Promise<Queue>;
  findById(id: string): Promise<Queue | null>;
  /** One atomic write guarded by `{ id, version }`; bumps the version. */
  update(id: string, version: number, patch: QueuePatch, now: Date): Promise<Queue | null>;
  /** One atomic delete guarded by `{ id, version }`. False when nothing matched. */
  remove(id: string, version: number): Promise<boolean>;
}

/** Ports owned by this module. A rejection is a dependency failure, never "does not exist". */
export type ProjectReader = (
  id: string,
) => Promise<{ items: readonly { partId: string; quantity: number }[] } | null>;
/** The live parts among the ids, in one call. A missing id is unknown or deleted. */
export type PartLookup = (ids: string[]) => Promise<ReadonlyMap<string, PartInfo>>;
/** The ids that are live and not archived printers. */
export type PrinterLookup = (ids: string[]) => Promise<ReadonlySet<string>>;

export interface NewQueue {
  readonly projectId: string;
  readonly goal: Goal;
  readonly mode: Mode;
  readonly printerIds: readonly string[];
  readonly lines?: readonly QueueLine[] | undefined;
}

/** A partial edit as validated at the border. */
export interface QueueEdit extends QueuePatch {
  readonly version: number;
}

export interface QueuesService {
  create(input: NewQueue): Promise<QueueDetail>;
  get(projectId: string): Promise<QueueDetail>;
  update(projectId: string, edit: QueueEdit): Promise<QueueDetail>;
  remove(projectId: string, version: number): Promise<void>;
}

const notFound = (): AppError => new AppError('not_found', 'The queue does not exist.');

const invalid = (issues: readonly FieldIssue[]): AppError =>
  new AppError('validation_failed', 'The request is not valid.', { issues });

const staleVersion = (): AppError =>
  new AppError('conflict', 'The queue was changed by someone else. Reload and retry.', {
    issues: [{ path: 'version', message: 'Does not match the current version.' }],
  });

/** Fails closed: a dependency that breaks is a 503, never "the record does not exist". */
async function dependable<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('service_unavailable', 'The queue data is temporarily unavailable.', {
      cause: error,
    });
  }
}

export function createQueuesService(deps: {
  repository: QueueRepository;
  projectReader: ProjectReader;
  partLookup: PartLookup;
  printerLookup: PrinterLookup;
  clock: Clock;
}): QueuesService {
  const { repository, clock } = deps;

  const lookupParts = async (
    lines: readonly QueueLine[],
  ): Promise<ReadonlyMap<string, PartInfo>> =>
    lines.length === 0
      ? new Map()
      : dependable(() => deps.partLookup([...new Set(lines.map((line) => line.partId))]));

  /** Parts and printers that do not exist (or are archived), with indexed paths. */
  async function referenceIssues(
    lines: readonly QueueLine[] | undefined,
    printerIds: readonly string[] | undefined,
    // Part ids kept as they are (an edit does not re-check the lines it did not touch).
    unchanged: ReadonlySet<string> = new Set(),
  ): Promise<FieldIssue[]> {
    const [parts, selectable] = await Promise.all([
      lookupParts((lines ?? []).filter((line) => !unchanged.has(line.partId))),
      printerIds === undefined || printerIds.length === 0
        ? Promise.resolve(new Set<string>())
        : dependable(() => deps.printerLookup([...new Set(printerIds)])),
    ]);
    return [
      ...(lines ?? []).flatMap((line, index) =>
        unchanged.has(line.partId) || parts.has(line.partId)
          ? []
          : [{ path: `lines.${String(index)}.partId`, message: 'The part does not exist.' }],
      ),
      ...(printerIds ?? []).flatMap((id, index) =>
        selectable.has(id)
          ? []
          : [
              {
                path: `printerIds.${String(index)}`,
                message: 'The printer does not exist or is archived.',
              },
            ],
      ),
    ];
  }

  /** The queue with the parts as they are now, and its totals. */
  async function detail(queue: Queue): Promise<QueueDetail> {
    const parts = await lookupParts(queue.lines);
    const totals = queueTotals(queue.lines, parts);
    if (totals === null) {
      throw new AppError('internal', 'The queue totals are out of range.');
    }
    return { queue, parts, totals };
  }

  return {
    async create(input) {
      const rules = [
        ...printerSelectionIssues(input.mode, input.printerIds),
        ...lineIssues(input.lines ?? []),
      ];
      if (rules.length > 0) throw invalid(rules);

      const project = await dependable(() => deps.projectReader(input.projectId));
      const lines =
        input.lines ??
        project?.items.map(({ partId, quantity }) => ({ partId, quantity, completed: 0 })) ??
        [];
      const issues = [
        ...(project === null
          ? [{ path: 'projectId', message: 'The project does not exist.' }]
          : []),
        ...(await referenceIssues(lines, input.printerIds)),
      ];
      if (issues.length > 0) throw invalid(issues);

      // Two creates for one project race on the unique _id: exactly one wins, the other is 409.
      const queue = await repository.create(
        input.projectId,
        { goal: input.goal, mode: input.mode, printerIds: input.printerIds, lines },
        clock.now(),
      );
      return detail(queue);
    },

    async get(projectId) {
      const queue = await repository.findById(projectId);
      if (queue === null) throw notFound();
      return detail(queue);
    },

    async update(projectId, edit) {
      const { version, ...patch } = edit;
      const current = await repository.findById(projectId);
      if (current === null) throw notFound();
      if (current.version !== version) throw staleVersion();

      // Rules on the merged result, so `mode` alone cannot leave the printers inconsistent.
      const rules = [
        ...printerSelectionIssues(
          patch.mode ?? current.mode,
          patch.printerIds ?? current.printerIds,
        ),
        ...(patch.lines === undefined ? [] : lineIssues(patch.lines)),
      ];
      if (rules.length > 0) throw invalid(rules);
      // Only what is new is checked: a printer archived or a part deleted later must not block an
      // edit of what the queue already holds.
      const issues = await referenceIssues(
        patch.lines,
        patch.printerIds,
        new Set(current.lines.map((existing) => existing.partId)),
      );
      if (issues.length > 0) throw invalid(issues);

      const updated = await repository.update(projectId, version, patch, clock.now());
      if (updated === null) {
        // The conditional write matched nothing: look again only to say why.
        if ((await repository.findById(projectId)) === null) throw notFound();
        throw staleVersion();
      }
      return detail(updated);
    },

    async remove(projectId, version) {
      if (await repository.remove(projectId, version)) return;
      if ((await repository.findById(projectId)) === null) throw notFound();
      throw staleVersion();
    },
  };
}
