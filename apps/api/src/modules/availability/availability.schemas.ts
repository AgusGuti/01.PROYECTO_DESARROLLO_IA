// Zod schemas for the availability API: the source of the OpenAPI contract (standard §7.1).
// Every input object is strict and integer-only; every list and string has a maximum.
import { z } from '../../shared/http/zod.js';
import {
  DAYS_PER_WEEK,
  MAX_ABSENCES,
  MAX_EXCEPTIONS,
  MAX_RANGES_PER_DAY,
  MINUTES_PER_DAY,
} from './availability.domain.js';

const minute = z.number().int().min(0).max(MINUTES_PER_DAY);

const rangeSchema = z
  .strictObject({
    startMinute: minute.openapi({ description: 'Minute of the day, 0..1440 (480 is 08:00).' }),
    endMinute: minute.openapi({ description: 'Exclusive end, greater than startMinute.' }),
  })
  .openapi('InterventionRange');

// Sorted and non-overlapping (touching ranges are fine). Issues point at the offending field.
const rangesSchema = z
  .array(rangeSchema)
  .max(MAX_RANGES_PER_DAY)
  .superRefine((ranges, ctx) => {
    ranges.forEach((range, index) => {
      if (range.startMinute >= range.endMinute) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'endMinute'],
          message: 'Must be greater than startMinute.',
        });
      }
      const previous = ranges[index - 1];
      if (previous !== undefined && range.startMinute < previous.endMinute) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'startMinute'],
          message: 'Ranges must be sorted and must not overlap.',
        });
      }
    });
  });

// A real calendar day, years 2000..2099, kept as the YYYY-MM-DD string (ADR 0011).
const dateSchema = z.iso
  .date()
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return year >= 2000 && year <= 2099;
  }, 'The year must be between 2000 and 2099.')
  .openapi({ type: 'string', format: 'date', example: '2026-12-25' });

const weekDaySchema = z.strictObject({
  ranges: rangesSchema.openapi({
    description: 'Where the user CAN intervene. Outside these ranges the user cannot.',
  }),
});

const exceptionSchema = z.strictObject({
  date: dateSchema,
  ranges: rangesSchema.openapi({
    description: 'Replaces that day. Empty: no intervention at all.',
  }),
});

const exceptionsSchema = z
  .array(exceptionSchema)
  .max(MAX_EXCEPTIONS)
  .superRefine((exceptions, ctx) => {
    const seen = new Set<string>();
    exceptions.forEach((exception, index) => {
      if (seen.has(exception.date)) {
        ctx.addIssue({ code: 'custom', path: [index, 'date'], message: 'Duplicate date.' });
      }
      seen.add(exception.date);
    });
  });

const absenceSchema = z.strictObject({
  from: dateSchema.openapi({ description: 'First day of the absence, inclusive.' }),
  to: dateSchema.openapi({ description: 'Last day of the absence, inclusive.' }),
});

// Sorted by `from`; any shared day is an overlap, but 10-12 followed by 13-15 is fine.
const absencesSchema = z
  .array(absenceSchema)
  .max(MAX_ABSENCES)
  .superRefine((absences, ctx) => {
    absences.forEach((absence, index) => {
      if (absence.to < absence.from) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'to'],
          message: 'Must not be before from.',
        });
      }
      const previous = absences[index - 1];
      if (previous !== undefined && absence.from <= previous.to) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'from'],
          message: 'Absences must be sorted and must not overlap.',
        });
      }
    });
  });

export const updateScheduleSchema = z
  .strictObject({
    weekly: z.array(weekDaySchema).length(DAYS_PER_WEEK).openapi({
      description: 'Exactly 7 entries: index 0 is Monday, 6 is Sunday.',
    }),
    exceptions: exceptionsSchema,
    absences: absencesSchema.openapi({
      description: 'Up to 30 day ranges with no intervention at all; they override exceptions.',
    }),
    version: z.number().int().min(0).openapi({
      description: '0 for the first save, otherwise the version last seen (ADR 0024).',
    }),
  })
  .openapi('UpdateScheduleRequest');

// Output: plain objects, no validation of what the server itself produced.
const outRange = z.object({ startMinute: z.number().int(), endMinute: z.number().int() });

export const scheduleSchema = z
  .object({
    weekly: z.array(z.object({ ranges: z.array(outRange) })),
    exceptions: z.array(
      z.object({
        date: z.iso.date().openapi({ type: 'string', format: 'date', example: '2026-12-25' }),
        ranges: z.array(outRange),
      }),
    ),
    absences: z.array(
      z.object({
        from: z.iso.date().openapi({ type: 'string', format: 'date', example: '2026-12-20' }),
        to: z.iso.date().openapi({ type: 'string', format: 'date', example: '2026-12-31' }),
      }),
    ),
    version: z.number().int().openapi({ description: '0 until the schedule is first saved.' }),
    updatedAt: z.iso.datetime().nullable().openapi({ example: '2026-01-01T12:00:00.000Z' }),
  })
  .openapi('InterventionSchedule');

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type ScheduleDto = z.infer<typeof scheduleSchema>;
