// Documents this module's routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { livenessSchema, readinessSchema } from './health.schemas.js';

export function registerHealthPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/health/live',
    operationId: 'getLiveness',
    tags: ['Health'],
    summary: 'Is the process running?',
    description: 'Liveness probe. Does not check dependencies. Not rate limited.',
    responses: {
      200: {
        description: 'The process is running.',
        content: { 'application/json': { schema: livenessSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/health/ready',
    operationId: 'getReadiness',
    tags: ['Health'],
    summary: 'Can the API serve traffic?',
    description: 'Readiness probe. Checks the database connection. Not rate limited.',
    responses: {
      200: {
        description: 'Every dependency is reachable.',
        content: { 'application/json': { schema: readinessSchema } },
      },
      503: {
        description: 'A dependency is down. The body says which one.',
        content: { 'application/json': { schema: readinessSchema } },
      },
    },
  });
}
