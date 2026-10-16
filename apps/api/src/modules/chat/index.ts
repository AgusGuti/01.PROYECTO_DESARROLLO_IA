// Public surface of the chat module (standard §1.2). It owns no collection.
import type { Router } from 'express';
import type { Logger } from 'pino';
import { createHttpAssistantClient } from './chat.assistant-client.js';
import { createChatController } from './chat.controller.js';
import { createChatRouter } from './chat.routes.js';
import { createChatService, type AssistantClient } from './chat.service.js';

export { registerChatPaths } from './chat.openapi.js';
export type { AssistantClient } from './chat.service.js';

export function createChatModule(deps: {
  /** Configured base URL of the assistant: the only place this module sends requests to. */
  assistantUrl: string;
  logger: Logger;
  /** Tests replace the HTTP client with a fake. */
  assistantClient?: AssistantClient;
}): { router: Router } {
  const service = createChatService({
    assistantClient:
      deps.assistantClient ?? createHttpAssistantClient({ baseUrl: deps.assistantUrl }),
    logger: deps.logger,
    now: () => Date.now(),
  });
  return { router: createChatRouter(createChatController(service)) };
}
