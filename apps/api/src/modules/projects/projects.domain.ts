// Business rules for projects (CU01, ADR 0016). Pure functions: no Express, Mongoose or Zod here.
import type { Material } from '../../shared/catalog/materials.js';

/** The order is the meaning: the list sorts by the position in this array. */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAX_ITEMS = 100;

/** A line: it references a part by id and never copies its values. */
export interface ProjectItem {
  readonly partId: string;
  readonly quantity: number;
}

/** The fields a user edits. `null` means "not set" for the description and the deadline. */
export interface ProjectFields {
  readonly name: string;
  readonly description: string | null;
  readonly priority: Priority;
  /** A calendar day stored as UTC midnight (ADR 0011). */
  readonly deadline: Date | null;
  readonly items: readonly ProjectItem[];
}

/** A stored project. `deletedAt` is null while it is live. */
export interface Project extends ProjectFields {
  readonly id: string;
  readonly version: number;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A partial edit. An absent key means "keep"; `null` clears description or deadline. */
export interface ProjectPatch {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly priority?: Priority | undefined;
  readonly deadline?: Date | null | undefined;
  /** Replaces the whole list; `[]` empties it. */
  readonly items?: readonly ProjectItem[] | undefined;
}

export const PROJECT_SORTS = ['deadline', 'priority', 'name', 'createdAt'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export interface ProjectListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly priority?: Priority | undefined;
  readonly sort: ProjectSort;
  readonly order: 'asc' | 'desc';
}

export interface ProjectPage {
  readonly items: readonly Project[];
  readonly total: number;
}

/** What a project needs to know about a part it uses. */
export interface PartSummary {
  readonly name: string;
  readonly material: Material;
}

/** A project plus the current data of the parts its lines reference (absent: not live). */
export interface ProjectDetail {
  readonly project: Project;
  readonly parts: ReadonlyMap<string, PartSummary>;
}

/** One live project that uses a part, seen from the part's side. */
export interface ProjectUse {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
}

export interface ProjectUsage {
  readonly total: number;
  readonly projects: readonly ProjectUse[];
}

export interface ItemIssue {
  readonly path: string;
  readonly message: string;
}

/** A part may appear once. The issue goes on the second occurrence. */
export function duplicatedItemIssues(items: readonly ProjectItem[]): ItemIssue[] {
  const seen = new Set<string>();
  const issues: ItemIssue[] = [];
  items.forEach((item, index) => {
    if (seen.has(item.partId)) {
      issues.push({ path: `items.${String(index)}.partId`, message: 'Duplicated part.' });
    }
    seen.add(item.partId);
  });
  return issues;
}

/** Lines whose part is not in the live set. Unknown and deleted look the same. */
export function missingPartIssues(
  items: readonly ProjectItem[],
  liveIds: ReadonlySet<string>,
): ItemIssue[] {
  const issues: ItemIssue[] = [];
  items.forEach((item, index) => {
    if (!liveIds.has(item.partId)) {
      issues.push({ path: `items.${String(index)}.partId`, message: 'The part does not exist.' });
    }
  });
  return issues;
}

/** Lines and total units, for the list. */
export function summarise(items: readonly ProjectItem[]): { itemCount: number; unitCount: number } {
  return {
    itemCount: items.length,
    unitCount: items.reduce((total, item) => total + item.quantity, 0),
  };
}
