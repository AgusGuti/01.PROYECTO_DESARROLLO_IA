// Use case: forward one message to the assistant. Stateless; nothing is stored.
import type { Logger } from 'pino';
import { AppError } from '../../shared/errors/app-error.js';
import { MAX_REPLY_CHARACTERS, proposalSchema, type ChatDto } from './chat.schemas.js';

/** Port owned by this module. The HTTP implementation lives in chat.assistant-client.ts. */
export interface AssistantClient {
  /** `proposal` is untrusted: the service validates it before it reaches a client. */
  ask(message: string): Promise<{ reply: string; proposal?: unknown }>;
}

/** The assistant answered 413: it judged the message too long. */
export class AssistantMessageTooLongError extends Error {
  constructor() {
    super('The assistant rejected the message as too long.');
    this.name = 'AssistantMessageTooLongError';
  }
}

export interface ChatService {
  ask(message: string): Promise<ChatDto>;
}

const UNAVAILABLE = 'The assistant is not available right now. Try again later.';

export function createChatService(deps: {
  assistantClient: AssistantClient;
  logger: Logger;
  now: () => number;
}): ChatService {
  const { assistantClient, logger, now } = deps;

  return {
    async ask(message) {
      const startedAt = now();
      // Only sizes, timings and the outcome are logged: the text may be personal data.
      const log = (outcome: string, replyLength?: number, proposal?: string): void => {
        logger.info(
          { outcome, messageLength: message.length, replyLength, proposal, ms: now() - startedAt },
          'chat',
        );
      };

      let reply: string;
      let rawProposal: unknown;
      try {
        ({ reply, proposal: rawProposal } = await assistantClient.ask(message));
      } catch (error) {
        if (error instanceof AssistantMessageTooLongError) {
          log('too_long');
          throw new AppError('validation_failed', 'The request is not valid.', {
            issues: [{ path: 'message', message: 'The message is too long.' }],
          });
        }
        log('unavailable');
        throw new AppError('service_unavailable', UNAVAILABLE, { cause: error });
      }
      if (reply.length > MAX_REPLY_CHARACTERS) {
        log('reply_too_long', reply.length);
        throw new AppError('service_unavailable', UNAVAILABLE);
      }
      // An invalid proposal is dropped, the reply is kept. Only the outcome is logged.
      if (rawProposal === undefined || rawProposal === null) {
        log('ok', reply.length, 'none');
        return { reply, proposal: null };
      }
      const parsed = proposalSchema.safeParse(rawProposal);
      log('ok', reply.length, parsed.success ? 'valid' : 'dropped');
      return { reply, proposal: parsed.success ? parsed.data : null };
    },
  };
}
