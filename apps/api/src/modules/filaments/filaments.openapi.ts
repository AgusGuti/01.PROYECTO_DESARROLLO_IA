// Documents the filaments routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import {
  consumeFilamentSchema,
  createFilamentSchema,
  filamentIdParamsSchema,
  filamentListSchema,
  filamentSchema,
  listFilamentsQuerySchema,
  updateFilamentSchema,
} from './filaments.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerFilamentsPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/filaments',
    operationId: 'createFilament',
    tags: ['Filaments'],
    summary: 'Register a filament spool',
    description: 'Two identical spools are allowed: there is no uniqueness rule.',
    request: { body: { content: { 'application/json': { schema: createFilamentSchema } } } },
    responses: {
      201: {
        description: 'Created. The Location header points to the new filament.',
        headers: { Location: { schema: { type: 'string' } } },
        content: { 'application/json': { schema: filamentSchema } },
      },
      400: problem(
        'Invalid input, availableGrams above initialGrams, or a purchase date in the future.',
      ),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/filaments',
    operationId: 'listFilaments',
    tags: ['Filaments'],
    summary: 'List filaments',
    description: 'Removed filaments are not listed.',
    request: { query: listFilamentsQuerySchema },
    responses: {
      200: {
        description: 'One page of filaments. A page past the last one is empty.',
        content: { 'application/json': { schema: filamentListSchema } },
      },
      400: problem('Unknown or invalid query parameter.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/filaments/{id}',
    operationId: 'getFilament',
    tags: ['Filaments'],
    summary: 'Get one filament',
    request: { params: filamentIdParamsSchema },
    responses: {
      200: {
        description: 'The filament.',
        content: { 'application/json': { schema: filamentSchema } },
      },
      400: problem('Malformed id.'),
      404: problem('No such filament, or it was removed.'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/filaments/{id}',
    operationId: 'updateFilament',
    tags: ['Filaments'],
    summary: 'Edit a filament',
    description: 'Send the `version` you last saw plus the fields to change.',
    request: {
      params: filamentIdParamsSchema,
      body: { content: { 'application/json': { schema: updateFilamentSchema } } },
    },
    responses: {
      200: {
        description: 'The updated filament, with its new version.',
        content: { 'application/json': { schema: filamentSchema } },
      },
      400: problem(
        'Invalid input, or the merged state breaks a rule (availableGrams above initialGrams, ' +
          'or a purchase date in the future).',
      ),
      404: problem('No such filament, or it was removed.'),
      409: problem('Stale version (issue path "version").'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/filaments/{id}',
    operationId: 'deleteFilament',
    tags: ['Filaments'],
    summary: 'Remove a filament',
    description: 'Logical removal: the document is kept but no longer listed or readable.',
    request: { params: filamentIdParamsSchema },
    responses: {
      204: { description: 'Removed.' },
      400: problem('Malformed id.'),
      404: problem('No such filament, or it was already removed.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/filaments/{id}/consume',
    operationId: 'consumeFilament',
    tags: ['Filaments'],
    summary: 'Take grams from a spool',
    description:
      'One atomic decrement. It needs no version: it does not conflict with edits, only with ' +
      'the stock left.',
    request: {
      params: filamentIdParamsSchema,
      body: { content: { 'application/json': { schema: consumeFilamentSchema } } },
    },
    responses: {
      200: {
        description: 'The filament with the grams taken off.',
        content: { 'application/json': { schema: filamentSchema } },
      },
      400: problem('Invalid input or malformed id.'),
      404: problem('No such filament, or it was removed.'),
      409: problem('Not enough material (issue path "grams"). The filament is unchanged.'),
    },
  });
}
