// Documents the availability routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import { scheduleSchema, updateScheduleSchema } from './availability.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerAvailabilityPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/api/v1/availability/schedule',
    operationId: 'getInterventionSchedule',
    tags: ['Availability'],
    summary: 'Get the intervention schedule',
    description:
      'When the user CAN intervene (change a piece). Times are minutes of the day in ' +
      'America/Argentina/Buenos_Aires. Before the first save it answers 08:00-18:00 every day ' +
      'with version 0. It never writes.',
    responses: {
      200: {
        description: 'The schedule.',
        content: { 'application/json': { schema: scheduleSchema } },
      },
      503: problem('The schedule is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/availability/schedule',
    operationId: 'saveInterventionSchedule',
    tags: ['Availability'],
    summary: 'Save the intervention schedule',
    description:
      'Full replacement: send the 7 weekly days, all exceptions and the version last seen ' +
      '(0 for the first save). Issue paths look like "weekly.2.ranges.1.endMinute".',
    request: { body: { content: { 'application/json': { schema: updateScheduleSchema } } } },
    responses: {
      200: {
        description: 'The saved schedule, with the new version.',
        content: { 'application/json': { schema: scheduleSchema } },
      },
      400: problem('Invalid input, an unknown field, overlapping ranges or a duplicate date.'),
      409: problem('Stale version (issue path "version").'),
      503: problem('The schedule is temporarily unavailable.'),
    },
  });
}
