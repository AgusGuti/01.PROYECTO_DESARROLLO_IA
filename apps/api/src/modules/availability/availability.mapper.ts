// Internal model -> response DTO. Fields are copied one by one, so nothing leaks by accident.
import type { MinuteRange, Schedule } from './availability.domain.js';
import type { ScheduleDto } from './availability.schemas.js';

const toRanges = (ranges: readonly MinuteRange[]) =>
  ranges.map(({ startMinute, endMinute }) => ({ startMinute, endMinute }));

export function toScheduleDto(schedule: Schedule): ScheduleDto {
  return {
    weekly: schedule.weekly.map((day) => ({ ranges: toRanges(day.ranges) })),
    exceptions: schedule.exceptions.map(({ date, ranges }) => ({ date, ranges: toRanges(ranges) })),
    absences: schedule.absences.map(({ from, to }) => ({ from, to })),
    version: schedule.version,
    updatedAt: schedule.updatedAt === null ? null : schedule.updatedAt.toISOString(),
  };
}
