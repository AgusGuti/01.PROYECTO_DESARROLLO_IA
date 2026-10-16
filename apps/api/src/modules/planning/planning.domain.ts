// Types of the planning settings (ADR 0027). Pure: no Express, Mongoose or Zod here.

/** The editable numbers. */
export interface PlanningRates {
  /** Time saved when identical pieces share a plate, in basis points (1000 is 10 %). 0..5000. */
  readonly batchSavingBasisPoints: number;
}

/** The settings as stored. Version 0 means "never saved" (ADR 0021, 0027). */
export interface PlanningSettings extends PlanningRates {
  readonly version: number;
  readonly updatedAt: Date | null;
}

export const MAX_BATCH_SAVING_BASIS_POINTS = 5000;

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  batchSavingBasisPoints: 0,
  version: 0,
  updatedAt: null,
};
