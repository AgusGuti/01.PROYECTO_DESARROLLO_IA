// Business rules for the print queue (CU07). Pure functions: no framework, no I/O.
import type { Material } from '../../shared/catalog/materials.js';
import type { FieldIssue } from '../../shared/errors/app-error.js';

export const GOALS = ['deadline', 'fastest', 'minimal_idle'] as const;
export type Goal = (typeof GOALS)[number];

export const MODES = ['single', 'multi'] as const;
export type Mode = (typeof MODES)[number];

export const MAX_LINES = 100;
export const MAX_QUANTITY = 1000;
export const MIN_MULTI_PRINTERS = 2;
export const MAX_PRINTERS = 10;

/**
 * A snapshot of one project line: which spool, how many to print and how many are already done.
 * `filamentId` is null only for a line stored before ADR 0036 (a legacy state that cannot be saved).
 */
export interface QueueLine {
  readonly partId: string;
  readonly filamentId: string | null;
  readonly quantity: number;
  readonly completed: number;
}

export interface QueueFields {
  readonly goal: Goal;
  readonly mode: Mode;
  readonly printerIds: readonly string[];
  readonly lines: readonly QueueLine[];
}

/** A stored queue. Its id is the id of its project (ADR 0025). */
export interface Queue extends QueueFields {
  readonly id: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The fields a PATCH may change. Absent keeps the current value. */
export interface QueuePatch {
  readonly goal?: Goal | undefined;
  readonly mode?: Mode | undefined;
  readonly printerIds?: readonly string[] | undefined;
  readonly lines?: readonly QueueLine[] | undefined;
}

/** The live part data a queue shows. A line whose part is missing is "deleted". */
export interface PartInfo {
  readonly name: string;
  readonly estimatedPrintSeconds: number;
}

/** What a queue line shows about its spool. A line whose spool is missing is "spool missing". */
export interface FilamentInfo {
  readonly brand: string;
  readonly material: Material;
  readonly colorName: string;
  readonly availableGrams: number;
}

export interface QueueTotals {
  readonly totalUnits: number;
  readonly completedUnits: number;
  readonly pendingUnits: number;
  readonly pendingSeconds: number;
}

export interface QueueDetail {
  readonly queue: Queue;
  readonly parts: ReadonlyMap<string, PartInfo>;
  readonly filaments: ReadonlyMap<string, FilamentInfo>;
  readonly totals: QueueTotals;
}

/** Units still to print on a line. */
export const pendingOf = (line: Pick<QueueLine, 'quantity' | 'completed'>): number =>
  line.quantity - line.completed;

/**
 * A repeated (part, spool) pair and a `completed` above `quantity`, each with its indexed path.
 * The same part may appear on several lines with different spools (ADR 0036).
 */
export function lineIssues(lines: readonly QueueLine[]): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const key = `${line.partId}:${line.filamentId ?? ''}`;
    if (seen.has(key)) {
      issues.push({
        path: `lines.${String(index)}.filamentId`,
        message: 'The part and spool are repeated.',
      });
    }
    seen.add(key);
    if (line.completed > line.quantity) {
      issues.push({
        path: `lines.${String(index)}.completed`,
        message: 'Must not be more than the quantity.',
      });
    }
  }
  return issues;
}

/** Every saved line needs a spool; a legacy `null` cannot be saved (ADR 0036). */
export function missingSpoolIssues(
  lines: readonly QueueLine[],
  message = 'Assign a spool to this line.',
): FieldIssue[] {
  return lines.flatMap((line, index) =>
    line.filamentId === null ? [{ path: `lines.${String(index)}.filamentId`, message }] : [],
  );
}

/**
 * A stored line with printed pieces keeps its part and spool and cannot be removed: the printed
 * pieces were made with that spool. Splitting is the way out. A legacy line without a spool may gain
 * one, so for it only the part must remain.
 */
export function lockedLineIssues(
  stored: readonly QueueLine[],
  next: readonly QueueLine[],
): FieldIssue[] {
  return stored
    .filter((line) => line.completed > 0)
    .filter(
      (line) =>
        !next.some(
          (candidate) =>
            candidate.partId === line.partId &&
            (line.filamentId === null || candidate.filamentId === line.filamentId),
        ),
    )
    .map(() => ({
      path: 'lines',
      message:
        'A line with printed pieces cannot change its part or spool, or be removed. To use ' +
        'another spool, split it: reduce its quantity to the printed pieces and add a second ' +
        'line of the same part with the other spool.',
    }));
}

/**
 * Distinct printers always; the count rule (single: 1, multi: 2..10) only when the mode is known.
 */
export function printerSelectionIssues(
  mode: Mode | undefined,
  printerIds: readonly string[],
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const seen = new Set<string>();
  for (const [index, id] of printerIds.entries()) {
    if (seen.has(id)) {
      issues.push({ path: `printerIds.${String(index)}`, message: 'The printer is repeated.' });
    }
    seen.add(id);
  }
  const count = printerIds.length;
  if (mode === undefined && count === 0) {
    issues.push({ path: 'printerIds', message: 'Select at least one printer.' });
  }
  if (mode === 'single' && count !== 1) {
    issues.push({ path: 'printerIds', message: 'Select exactly one printer in single mode.' });
  }
  if (mode === 'multi' && (count < MIN_MULTI_PRINTERS || count > MAX_PRINTERS)) {
    issues.push({ path: 'printerIds', message: 'Select between 2 and 10 printers in multi mode.' });
  }
  return issues;
}

/**
 * Progress of the queue. Seconds count only lines whose part is still live: a deleted part has no
 * known print time. Returns null when a sum leaves the safe-integer range.
 */
export function queueTotals(
  lines: readonly QueueLine[],
  parts: ReadonlyMap<string, PartInfo>,
): QueueTotals | null {
  let totalUnits = 0;
  let completedUnits = 0;
  let pendingSeconds = 0;
  for (const line of lines) {
    totalUnits += line.quantity;
    completedUnits += line.completed;
    pendingSeconds += pendingOf(line) * (parts.get(line.partId)?.estimatedPrintSeconds ?? 0);
    if (!Number.isSafeInteger(pendingSeconds)) return null;
  }
  return { totalUnits, completedUnits, pendingUnits: totalUnits - completedUnits, pendingSeconds };
}
