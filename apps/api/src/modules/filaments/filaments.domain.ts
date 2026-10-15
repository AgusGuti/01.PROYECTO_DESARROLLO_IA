// Business rules for filaments (CU05). Pure functions: no Express, Mongoose or Zod here.
import type { Material } from '../../shared/catalog/materials.js';

/** The fields a user edits. `purchaseDate` is a UTC-midnight Date (ADR 0011). */
export interface FilamentFields {
  readonly brand: string;
  readonly material: Material;
  readonly colorName: string;
  readonly initialGrams: number;
  readonly availableGrams: number;
  /** Centavos of ARS. */
  readonly purchaseCostMinor: number;
  readonly purchaseDate: Date;
}

/** A stored filament spool. `deletedAt` is null while it is live. */
export interface Filament extends FilamentFields {
  readonly id: string;
  readonly version: number;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A partial edit. An absent key means "keep". */
export interface FilamentPatch {
  readonly brand?: string | undefined;
  readonly material?: Material | undefined;
  readonly colorName?: string | undefined;
  readonly initialGrams?: number | undefined;
  readonly availableGrams?: number | undefined;
  readonly purchaseCostMinor?: number | undefined;
  readonly purchaseDate?: Date | undefined;
}

export const FILAMENT_SORTS = ['purchaseDate', 'brand', 'availableGrams', 'createdAt'] as const;
export type FilamentSort = (typeof FILAMENT_SORTS)[number];

export interface FilamentListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly material?: Material | undefined;
  /** true: availableGrams > 0; false: availableGrams = 0; absent: both. */
  readonly inStock?: boolean | undefined;
  readonly sort: FilamentSort;
  readonly order: 'asc' | 'desc';
}

export interface FilamentPage {
  readonly items: readonly Filament[];
  readonly total: number;
}

export interface RuleIssue {
  readonly path: string;
  readonly message: string;
}

/** The state a PATCH would produce. The rules must be checked on this, not on the patch alone. */
export function mergeFilament(current: FilamentFields, patch: FilamentPatch): FilamentFields {
  return {
    brand: patch.brand ?? current.brand,
    material: patch.material ?? current.material,
    colorName: patch.colorName ?? current.colorName,
    initialGrams: patch.initialGrams ?? current.initialGrams,
    availableGrams: patch.availableGrams ?? current.availableGrams,
    purchaseCostMinor: patch.purchaseCostMinor ?? current.purchaseCostMinor,
    purchaseDate: patch.purchaseDate ?? current.purchaseDate,
  };
}

/** Midnight UTC of the day `now` falls in. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Rule: a spool cannot hold more than it started with. */
export function exceedsInitialGrams(
  fields: Pick<FilamentFields, 'initialGrams' | 'availableGrams'>,
) {
  return fields.availableGrams > fields.initialGrams;
}

/** Rule: the purchase date is not after the UTC date of `now`. */
export function isFutureDate(purchaseDate: Date, now: Date): boolean {
  return purchaseDate.getTime() > startOfUtcDay(now).getTime();
}

/**
 * All rule violations of a filament state. `checkDate` is false on an edit that leaves the date
 * alone, so an old record is never blocked by a rule about a field the user did not touch.
 * @returns an empty list when the state is allowed.
 */
export function filamentRuleIssues(
  fields: FilamentFields,
  now: Date,
  checkDate: boolean,
): readonly RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (exceedsInitialGrams(fields)) {
    issues.push({ path: 'availableGrams', message: 'Must not exceed initialGrams.' });
  }
  if (checkDate && isFutureDate(fields.purchaseDate, now)) {
    issues.push({ path: 'purchaseDate', message: 'Must not be in the future.' });
  }
  return issues;
}
