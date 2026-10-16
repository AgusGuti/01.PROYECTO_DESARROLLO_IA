// Documents the queues routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import {
  createQueueSchema,
  deleteQueueQuerySchema,
  queueParamsSchema,
  queueSchema,
  updateQueueSchema,
} from './queues.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerQueuesPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/queues',
    operationId: 'createQueue',
    tags: ['Queues'],
    summary: 'Create the print queue of a project',
    description:
      'A project has at most one queue; its id is the project id. Without `lines` they are ' +
      'copied from the project items. Every problem is reported at once with indexed paths ' +
      '("lines.2.partId", "printerIds.1"). Archived printers cannot be selected.',
    request: { body: { content: { 'application/json': { schema: createQueueSchema } } } },
    responses: {
      201: {
        description: 'Created. The Location header points to the queue.',
        headers: { Location: { schema: { type: 'string' } } },
        content: { 'application/json': { schema: queueSchema } },
      },
      400: problem('Invalid input, unknown project, part or printer, or a wrong printer count.'),
      409: problem('The project already has a queue (issue path "projectId").'),
      503: problem('The project, part or printer data is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/queues/{projectId}',
    operationId: 'getQueue',
    tags: ['Queues'],
    summary: 'Get the print queue of a project',
    description:
      'Each line shows the part as it is now (`partDeleted` when it is gone) and the progress ' +
      'of the project is summed in `totals`.',
    request: { params: queueParamsSchema },
    responses: {
      200: { description: 'The queue.', content: { 'application/json': { schema: queueSchema } } },
      400: problem('Malformed id.'),
      404: problem('The project has no queue.'),
      503: problem('The part data is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/queues/{projectId}',
    operationId: 'updateQueue',
    tags: ['Queues'],
    summary: 'Edit the print queue of a project',
    description:
      'Send the version last seen and any of goal, mode, printerIds and lines (replaced whole). ' +
      'The rules apply to the merged result, so changing `mode` may need new `printerIds`.',
    request: {
      params: queueParamsSchema,
      body: { content: { 'application/json': { schema: updateQueueSchema } } },
    },
    responses: {
      200: {
        description: 'The updated queue, with the new version.',
        content: { 'application/json': { schema: queueSchema } },
      },
      400: problem('Invalid input, unknown part or printer, or a wrong printer count.'),
      404: problem('The project has no queue.'),
      409: problem('Stale version (issue path "version").'),
      503: problem('The part, printer or queue data is temporarily unavailable.'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/queues/{projectId}',
    operationId: 'deleteQueue',
    tags: ['Queues'],
    summary: 'Delete the print queue of a project',
    description:
      'Permanent: the queue is derived data and can be created again. Needs `?version=N`.',
    request: { params: queueParamsSchema, query: deleteQueueQuerySchema },
    responses: {
      204: { description: 'Deleted.' },
      400: problem('Malformed id or missing version.'),
      404: problem('The project has no queue.'),
      409: problem('Stale version (issue path "version").'),
    },
  });
}
