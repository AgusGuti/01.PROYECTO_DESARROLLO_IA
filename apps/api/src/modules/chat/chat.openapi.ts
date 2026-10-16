// Documents the chat route in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import { chatRequestSchema, chatResponseSchema } from './chat.schemas.js';

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
      'message to the assistant (ADR 0004, 0029) and returns its reply. It can take many seconds.',
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
}
