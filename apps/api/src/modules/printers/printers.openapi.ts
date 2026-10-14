// Documents the printers routes in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import {
  createPrinterSchema,
  listPrintersQuerySchema,
  printerIdParamsSchema,
  printerListSchema,
  printerSchema,
  updatePrinterSchema,
} from './printers.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerPrintersPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/printers',
    operationId: 'createPrinter',
    tags: ['Printers'],
    summary: 'Register a printer',
    request: { body: { content: { 'application/json': { schema: createPrinterSchema } } } },
    responses: {
      201: {
        description: 'Created. The Location header points to the new printer.',
        headers: { Location: { schema: { type: 'string' } } },
        content: { 'application/json': { schema: printerSchema } },
      },
      200: {
        description:
          'Restored. A deleted printer with this name was revived with the submitted data ' +
          '(only with restoreIfDeleted true). The Location header points to it.',
        headers: { Location: { schema: { type: 'string' } } },
        content: { 'application/json': { schema: printerSchema } },
      },
      400: problem('Invalid input, or a reinforced material without a hardened_steel nozzle.'),
      409: problem(
        'The name is taken. Issue path "name": a live or pending-removal printer holds it. ' +
          'Issue path "restoreIfDeleted": a deleted printer holds it; resend with restoreIfDeleted true to restore it.',
      ),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/printers/{id}/unarchive',
    operationId: 'unarchivePrinter',
    tags: ['Printers'],
    summary: 'Cancel the pending removal of a printer',
    description:
      'Clears archivedAt so the printer can be edited again. Repeating it on a printer that is ' +
      'not pending removal is a 200 with no change.',
    request: { params: printerIdParamsSchema },
    responses: {
      200: {
        description: 'The printer, no longer pending removal.',
        content: { 'application/json': { schema: printerSchema } },
      },
      400: problem('Malformed id.'),
      404: problem('No such printer, or it was removed.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/printers',
    operationId: 'listPrinters',
    tags: ['Printers'],
    summary: 'List printers',
    description:
      'Includes printers pending removal (archivedAt set). Removed printers are not listed.',
    request: { query: listPrintersQuerySchema },
    responses: {
      200: {
        description: 'One page of printers. A page past the last one is empty.',
        content: { 'application/json': { schema: printerListSchema } },
      },
      400: problem('Unknown or invalid query parameter.'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/printers/{id}',
    operationId: 'getPrinter',
    tags: ['Printers'],
    summary: 'Get one printer',
    request: { params: printerIdParamsSchema },
    responses: {
      200: {
        description: 'The printer (also when it is pending removal).',
        content: { 'application/json': { schema: printerSchema } },
      },
      400: problem('Malformed id.'),
      404: problem('No such printer, or it was removed.'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/printers/{id}',
    operationId: 'updatePrinter',
    tags: ['Printers'],
    summary: 'Edit a printer',
    description:
      'Send the `version` you last saw plus the fields to change. Nested objects and ' +
      '`compatibleMaterials` are replaced whole; `typicalSpeedMmS: null` clears the speed.',
    request: {
      params: printerIdParamsSchema,
      body: { content: { 'application/json': { schema: updatePrinterSchema } } },
    },
    responses: {
      200: {
        description: 'The updated printer, with its new version.',
        content: { 'application/json': { schema: printerSchema } },
      },
      400: problem('Invalid input, or the merged state breaks a rule.'),
      404: problem('No such printer, or it was removed.'),
      409: problem(
        'Stale version (issue path "version"), duplicate name (path "name"), or the printer is pending removal.',
      ),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/printers/{id}',
    operationId: 'deletePrinter',
    tags: ['Printers'],
    summary: 'Remove a printer',
    description:
      'Never physical. An idle printer is removed; one in use or with assignments becomes ' +
      'pending removal (archivedAt set). Repeating the request on a pending printer is a 204.',
    request: { params: printerIdParamsSchema },
    responses: {
      204: { description: 'Removed, or pending removal.' },
      400: problem('Malformed id.'),
      404: problem('No such printer, or it was already removed.'),
    },
  });
}
