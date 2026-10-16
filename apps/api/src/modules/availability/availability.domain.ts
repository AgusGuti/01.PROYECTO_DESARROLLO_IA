// Business rules of the intervention schedule (CU09), pure functions with no framework.
// Times are wall-clock minutes of America/Argentina/Buenos_Aires (no DST), so no time-zone
// library is needed (ADR 0024). A range is end-exclusive: 480..1080 is 08:00 up to 17:59.

export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_WEEK = 7;
export const MAX_RANGES_PER_DAY = 6;
export const MAX_EXCEPTIONS = 60;

/** The user CAN intervene (change a piece) from `startMinute` up to, not including, `endMinute`. */
export interface MinuteRange {
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface WeekDay {
  readonly ranges: readonly MinuteRange[];
}

/** Replaces the weekly ranges of one calendar day (`YYYY-MM-DD`). Empty ranges: never. */
export interface ScheduleException {
  readonly date: string;
  readonly ranges: readonly MinuteRange[];
}

/** What a user edits. `weekly` has exactly 7 entries: index 0 is Monday, 6 is Sunday. */
export interface ScheduleRules {
  readonly weekly: readonly WeekDay[];
  readonly exceptions: readonly ScheduleException[];
}

export interface Schedule extends ScheduleRules {
  /** 0 until the schedule is first saved. */
  readonly version: number;
  readonly updatedAt: Date | null;
}

const DEFAULT_RANGE: MinuteRange = { startMinute: 480, endMinute: 1080 };

/** Answered before the first save: every day 08:00-18:00, no exceptions. */
export const DEFAULT_SCHEDULE: Schedule = {
  weekly: Array.from({ length: DAYS_PER_WEEK }, () => ({ ranges: [DEFAULT_RANGE] })),
  exceptions: [],
  version: 0,
  updatedAt: null,
};

/** 0 = Monday ... 6 = Sunday, from the calendar date alone (UTC arithmetic, no local zone). */
export function weekdayOf(date: string): number {
  const sundayFirst = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return (sundayFirst + 6) % DAYS_PER_WEEK;
}

/** The ranges that apply on `date`: its exception if there is one, else the weekly day. */
export function interventionRangesFor(
  schedule: ScheduleRules,
  date: string,
): readonly MinuteRange[] {
  const exception = schedule.exceptions.find((candidate) => candidate.date === date);
  if (exception !== undefined) return exception.ranges;
  return schedule.weekly[weekdayOf(date)]?.ranges ?? [];
}

/** True when the user can intervene at `minute` (0..1439) of `date`. The end is exclusive. */
export function isInterventionPossible(
  schedule: ScheduleRules,
  date: string,
  minute: number,
): boolean {
  return interventionRangesFor(schedule, date).some(
    (range) => minute >= range.startMinute && minute < range.endMinute,
  );
}
