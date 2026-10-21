// Types of the planning settings (ADR 0027). Pure: no Express, Mongoose or Zod here.

/** The editable numbers. */
export interface PlanningRates {
  /** Time saved when identical pieces share a plate, in basis points (1000 is 10 %). 0..5000. */
  readonly batchSavingBasisPoints: number;
  /** Minutes between a print ending and the next one on the same printer starting (ADR 0036). */
  readonly printerTurnaroundMinutes: number;
  /** Extra minutes when the next print on that printer uses a different spool (ADR 0036). */
  readonly filamentChangeMinutes: number;
}

/** The settings as stored. Version 0 means "never saved" (ADR 0021, 0027). */
export interface PlanningSettings extends PlanningRates {
  readonly version: number;
  readonly updatedAt: Date | null;
}

export const MAX_BATCH_SAVING_BASIS_POINTS = 5000;
export const MAX_SETUP_MINUTES = 240;
export const DEFAULT_TURNAROUND_MINUTES = 10;
export const DEFAULT_FILAMENT_CHANGE_MINUTES = 30;

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  batchSavingBasisPoints: 0,
  printerTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
  filamentChangeMinutes: DEFAULT_FILAMENT_CHANGE_MINUTES,
  version: 0,
  updatedAt: null,
};
