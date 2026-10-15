// Documents the costs routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import {
  costEstimateRequestSchema,
  costEstimateSchema,
  costSettingsSchema,
  updateCostSettingsSchema,
} from './costs.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerCostsPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/costs/estimates',
    operationId: 'estimateCost',
    tags: ['Costs'],
    summary: 'Estimate the cost of printing a part',
    description:
      'Stateless: nothing is stored. Every amount is an integer in centavos of ARS and the lines ' +
      'add up to the total. A margin is added only when marginBasisPoints is sent. Unknown ids ' +
      'are reported together as issues on partId, filamentId and printerId.',
    request: { body: { content: { 'application/json': { schema: costEstimateRequestSchema } } } },
    responses: {
      200: {
        description: 'The estimate.',
        content: { 'application/json': { schema: costEstimateSchema } },
      },
      400: problem(
        'Invalid input, an unknown part, spool or printer, a spool material that differs from ' +
          'the part material (issue path "filamentId"), or amounts too large (path "quantity").',
      ),
      503: problem('The part, spool, printer or settings data is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/costs/settings',
    operationId: 'getCostSettings',
    tags: ['Costs'],
    summary: 'Get the cost settings',
    description: 'Before the first save it answers zeros with version 0. It never writes.',
    responses: {
      200: {
        description: 'The settings.',
        content: { 'application/json': { schema: costSettingsSchema } },
      },
      503: problem('The settings are temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/api/v1/costs/settings',
    operationId: 'saveCostSettings',
    tags: ['Costs'],
    summary: 'Save the cost settings',
    description: 'Send all four numbers and the version last seen (0 for the first save).',
    request: {
      body: { content: { 'application/json': { schema: updateCostSettingsSchema } } },
    },
    responses: {
      200: {
        description: 'The saved settings, with the new version.',
        content: { 'application/json': { schema: costSettingsSchema } },
      },
      400: problem('Invalid input or an unknown field.'),
      409: problem('Stale version (issue path "version").'),
      503: problem('The settings are temporarily unavailable.'),
    },
  });
}
