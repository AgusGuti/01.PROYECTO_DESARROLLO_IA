// Documents the chat route in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import {
  chatRequestSchema,
  chatResponseSchema,
  gcodeImportRequestSchema,
  gcodeImportResultSchema,
} from './chat.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerChatPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/chat',
    operationId: 'askAssistant',
    tags: ['Chat'],
    summary: 'Send one message to the assistant',
    description:
      'Stateless: nothing is stored and there is no conversation history. The API forwards the ' +
      'message to the assistant (ADR 0004, 0029) and returns its reply, plus an optional proposal (ADR 0031). ' +
      'It can take many seconds.',
    request: { body: { content: { 'application/json': { schema: chatRequestSchema } } } },
    responses: {
      200: {
        description: 'The assistant reply.',
        content: { 'application/json': { schema: chatResponseSchema } },
      },
      400: problem(
        'Invalid input. Issue path "message": empty, too long (over 2000) or unknown key.',
      ),
      503: problem('The assistant is unreachable, timed out or answered something unusable.'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/gcode-imports',
    operationId: 'importGcodes',
    tags: ['Chat'],
    summary: 'Import the .gcode files of a folder as parts (confirmed assistant proposal)',
    description:
      'Sent by the browser only after the user confirmed an import_gcodes proposal (ADR 0035). ' +
      'The API forwards it to the assistant, which runs the local G-code import for its configured ' +
      'folder. One material per batch. Idempotent (ADR 0034): parts already imported from the same ' +
      'file are updated or left alone. It can take minutes.',
    request: { body: { content: { 'application/json': { schema: gcodeImportRequestSchema } } } },
    responses: {
      200: {
        description: 'How many files were created, updated, left unchanged, skipped or failed.',
        content: { 'application/json': { schema: gcodeImportResultSchema } },
      },
      400: problem('Invalid input: unknown material, unsafe folder or unknown key.'),
      503: problem('The assistant or the import is unreachable, off, timed out or unusable.'),
    },
  });
}
