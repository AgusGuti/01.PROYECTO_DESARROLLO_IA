// Documents the parts routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import {
  createPartSchema,
  listPartsQuerySchema,
  partIdParamsSchema,
  partListSchema,
  partSchema,
  partUsageSchema,
  removePartQuerySchema,
  updatePartSchema,
} from './parts.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerPartsPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/parts',
    operationId: 'createPart',
    tags: ['Parts'],
    summary: 'Register a part',
    description:
      'Two parts may share a name: there is no uniqueness rule. A gcode `source` is stamped ' +
      'with `analyzedAt` by the server; sending it is a 400.',
    request: { body: { content: { 'application/json': { schema: createPartSchema } } } },
    responses: {
      201: {
        description: 'Created. The Location header points to the new part.',
        headers: { Location: { schema: { type: 'string' } } },
        content: { 'application/json': { schema: partSchema } },
      },
      400: problem('Invalid input or an unknown field.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/parts',
    operationId: 'listParts',
    tags: ['Parts'],
    summary: 'List parts',
    description: 'Removed parts are not listed.',
    request: { query: listPartsQuerySchema },
    responses: {
      200: {
        description: 'One page of parts. A page past the last one is empty.',
        content: { 'application/json': { schema: partListSchema } },
      },
      400: problem('Unknown or invalid query parameter.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/parts/{id}',
    operationId: 'getPart',
    tags: ['Parts'],
    summary: 'Get one part',
    request: { params: partIdParamsSchema },
    responses: {
      200: {
        description: 'The part.',
        content: { 'application/json': { schema: partSchema } },
      },
      400: problem('Malformed id.'),
      404: problem('No such part, or it was removed.'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/parts/{id}',
    operationId: 'updatePart',
    tags: ['Parts'],
    summary: 'Edit a part',
    description:
      'Send the `version` you last saw plus the fields to change. `dimensionsMm` is replaced ' +
      'whole. `null` clears `description` or `suggestedPrinterName`. `analyzedAt` is stamped ' +
      'again only when the body carries a `source`.',
    request: {
      params: partIdParamsSchema,
      body: { content: { 'application/json': { schema: updatePartSchema } } },
    },
    responses: {
      200: {
        description: 'The updated part, with its new version.',
        content: { 'application/json': { schema: partSchema } },
      },
      400: problem('Invalid input or an unknown field.'),
      404: problem('No such part, or it was removed.'),
      409: problem('Stale version (issue path "version").'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/parts/{id}',
    operationId: 'deletePart',
    tags: ['Parts'],
    summary: 'Remove a part',
    description:
      'Logical removal: the document is kept but no longer listed or readable. A part that ' +
      'live projects use is refused with 409 (issue path "projects"); ask ' +
      '`GET /parts/{id}/usage` and repeat with `removeFromProjects=true` to pull it from ' +
      'those projects first and then remove it.',
    request: { params: partIdParamsSchema, query: removePartQuerySchema },
    responses: {
      204: { description: 'Removed.' },
      400: problem('Malformed id or unknown query parameter.'),
      404: problem('No such part, or it was already removed.'),
      409: problem('Live projects use the part and removal was not confirmed.'),
      503: problem('The project data is temporarily unavailable; nothing was removed.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/parts/{id}/usage',
    operationId: 'getPartUsage',
    tags: ['Parts'],
    summary: 'Which live projects use a part',
    request: { params: partIdParamsSchema },
    responses: {
      200: {
        description: 'The true total and at most 50 projects, sorted by name then id.',
        content: { 'application/json': { schema: partUsageSchema } },
      },
      400: problem('Malformed id.'),
      404: problem('No such part, or it was removed.'),
      503: problem('The project data is temporarily unavailable.'),
    },
  });
}
