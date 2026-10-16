// Zod schemas for the chat API (ADR 0029). The API enforces its own limit; it does not rely on
// the assistant's.
import { z } from '../../shared/http/zod.js';

export const MAX_MESSAGE_CHARACTERS = 2000;
export const MAX_REPLY_CHARACTERS = 10_000;

export const chatRequestSchema = z
  .strictObject({
    message: z
      .string()
      .trim()
      .min(1)
      .max(MAX_MESSAGE_CHARACTERS)
      .openapi({ description: 'The user message, trimmed. It is never stored or logged.' }),
  })
  .openapi('ChatRequest');

export const chatResponseSchema = z
  .strictObject({
    reply: z.string().max(MAX_REPLY_CHARACTERS).openapi({ description: 'The assistant reply.' }),
  })
  .openapi('ChatResponse');

/** What the assistant's POST /chat answers. Parsed, never trusted. */
export const assistantReplySchema = z.object({ reply: z.string().min(1) });

export type ChatDto = z.infer<typeof chatResponseSchema>;
