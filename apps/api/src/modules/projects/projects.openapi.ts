// Documents the projects routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  projectListSchema,
  projectSchema,
  updateProjectSchema,
} from './projects.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerProjectsPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/projects',
    operationId: 'createProject',
    tags: ['Projects'],
    summary: 'Register a project',
    description:
      'Two projects may share a name. A past deadline is allowed and a project may have no ' +
      'lines. Every line must reference a live part (issue path "items.N.partId").',
    request: { body: { content: { 'application/json': { schema: createProjectSchema } } } },
    responses: {
      201: {
        description: 'Created. The Location header points to the new project.',
        headers: { Location: { schema: { type: 'string' } } },
        content: { 'application/json': { schema: projectSchema } },
      },
      400: problem(
        'Invalid input, an unknown field, a repeated part or a part that does not exist.',
      ),
      503: problem('The part data is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/projects',
    operationId: 'listProjects',
    tags: ['Projects'],
    summary: 'List projects',
    description:
      'Removed projects are not listed. Sorting by priority goes low, normal, high, urgent. ' +
      'Projects without a deadline come last in both directions.',
    request: { query: listProjectsQuerySchema },
    responses: {
      200: {
        description: 'One page of project summaries. A page past the last one is empty.',
        content: { 'application/json': { schema: projectListSchema } },
      },
      400: problem('Unknown or invalid query parameter.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/projects/{id}',
    operationId: 'getProject',
    tags: ['Projects'],
    summary: 'Get one project',
    description: 'Each line carries the part as it is now, or `part: null` when it was deleted.',
    request: { params: projectIdParamsSchema },
    responses: {
      200: {
        description: 'The project.',
        content: { 'application/json': { schema: projectSchema } },
      },
      400: problem('Malformed id.'),
      404: problem('No such project, or it was removed.'),
      503: problem('The part data is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/projects/{id}',
    operationId: 'updateProject',
    tags: ['Projects'],
    summary: 'Edit a project',
    description:
      'Send the `version` you last saw plus the fields to change. `items` is replaced whole ' +
      '(`[]` empties it). `null` clears `description` or `deadline`.',
    request: {
      params: projectIdParamsSchema,
      body: { content: { 'application/json': { schema: updateProjectSchema } } },
    },
    responses: {
      200: {
        description: 'The updated project, with its new version.',
        content: { 'application/json': { schema: projectSchema } },
      },
      400: problem(
        'Invalid input, an unknown field, a repeated part or a part that does not exist.',
      ),
      404: problem('No such project, or it was removed.'),
      409: problem('Stale version (issue path "version").'),
      503: problem('The part data is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/projects/{id}',
    operationId: 'deleteProject',
    tags: ['Projects'],
    summary: 'Remove a project',
    description: 'Logical removal: the document is kept but no longer listed or readable.',
    request: { params: projectIdParamsSchema },
    responses: {
      204: { description: 'Removed.' },
      400: problem('Malformed id.'),
      404: problem('No such project, or it was already removed.'),
    },
  });
}
