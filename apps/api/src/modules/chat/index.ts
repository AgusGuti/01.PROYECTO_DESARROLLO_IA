// Public surface of the chat module (standard §1.2). It owns no collection.
import type { Router } from 'express';
import type { Logger } from 'pino';
import { createHttpAssistantClient, createHttpGcodeImportClient } from './chat.assistant-client.js';
import { createChatController, createGcodeImportController } from './chat.controller.js';
import { createChatRouter, createGcodeImportRouter } from './chat.routes.js';
import {
  createChatService,
  createGcodeImportService,
  type AssistantClient,
  type GcodeImportClient,
} from './chat.service.js';

export { registerChatPaths } from './chat.openapi.js';
export type { AssistantClient, GcodeImportClient } from './chat.service.js';

export function createChatModule(deps: {
  /** Configured base URL of the assistant: the only place this module sends requests to. */
  assistantUrl: string;
  logger: Logger;
  /** Tests replace the HTTP clients with fakes. */
  assistantClient?: AssistantClient;
  gcodeImportClient?: GcodeImportClient;
}): { router: Router; gcodeImportRouter: Router } {
  const now = (): number => Date.now();
  const service = createChatService({
    assistantClient:
      deps.assistantClient ?? createHttpAssistantClient({ baseUrl: deps.assistantUrl }),
    logger: deps.logger,
    now,
  });
  const importService = createGcodeImportService({
    client: deps.gcodeImportClient ?? createHttpGcodeImportClient({ baseUrl: deps.assistantUrl }),
    logger: deps.logger,
    now,
  });
  return {
    router: createChatRouter(createChatController(service)),
    gcodeImportRouter: createGcodeImportRouter(createGcodeImportController(importService)),
  };
}
