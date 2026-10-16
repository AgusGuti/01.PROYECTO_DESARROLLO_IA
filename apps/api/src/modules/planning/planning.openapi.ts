// Documents the planning routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import { planningSettingsSchema, updatePlanningSettingsSchema } from './planning.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerPlanningPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/api/v1/planning/settings',
    operationId: 'getPlanningSettings',
    tags: ['Planning'],
    summary: 'Get the planning settings',
    description: 'Before the first save it answers a zero saving with version 0. It never writes.',
    responses: {
      200: {
        description: 'The settings.',
        content: { 'application/json': { schema: planningSettingsSchema } },
      },
      503: problem('The settings are temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/planning/settings',
    operationId: 'savePlanningSettings',
    tags: ['Planning'],
    summary: 'Save the planning settings',
    description:
      'Send the batch saving (basis points, 0 to 5000) and the version last seen (0 for the ' +
      'first save).',
    request: {
      body: { content: { 'application/json': { schema: updatePlanningSettingsSchema } } },
    },
    responses: {
      200: {
        description: 'The saved settings, with the new version.',
        content: { 'application/json': { schema: planningSettingsSchema } },
      },
      400: problem('Invalid input or an unknown field.'),
      409: problem('Stale version (issue path "version").'),
      503: problem('The settings are temporarily unavailable.'),
    },
  });
}
