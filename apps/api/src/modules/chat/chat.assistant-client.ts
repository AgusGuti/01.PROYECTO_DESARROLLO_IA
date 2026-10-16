// HTTP implementation of the AssistantClient port with the global fetch.
// SSRF: the URL is the configured base plus a fixed path; nothing from a client reaches it.
import { assistantReplySchema } from './chat.schemas.js';
import { AssistantMessageTooLongError, type AssistantClient } from './chat.service.js';

/** The model can be slow on modest hardware (ADR 0004); this is the ceiling per call. */
export const ASSISTANT_TIMEOUT_MS = 60_000;

export function createHttpAssistantClient(options: {
  baseUrl: string;
  timeoutMs?: number;
}): AssistantClient {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat`;
  const timeoutMs = options.timeoutMs ?? ASSISTANT_TIMEOUT_MS;

  return {
    async ask(message) {
      // Not retried: a chat call spends model time and is not safely repeatable.
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ message }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      if (response.status === 413) throw new AssistantMessageTooLongError();
      if (!response.ok) throw new Error(`assistant answered ${response.status}`);
      // Throws on a body that is not JSON or not the expected shape; the service maps it to 503.
      return assistantReplySchema.parse(await response.json()).reply;
    },
  };
}
