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

// Proposal rules (ADR 0031). These DUPLICATE the create-project body rules of
// projects/projects.schemas.ts on purpose: a module does not import another module's internals.
// If a rule differs, the projects module wins: the browser's POST /api/v1/projects re-validates.
const CONTROL_CHARACTER = /\p{Cc}/u;
const codePoints = (value: string): number => Array.from(value).length;
const PROPOSAL_MAX_ITEMS = 100;

const proposalText = (max: number, example: string) =>
  z
    .string()
    .refine((value) => !CONTROL_CHARACTER.test(value), 'Must not contain control characters.')
    .refine((value) => codePoints(value.trim()) >= 1, 'Must not be empty.')
    .refine(
      (value) => codePoints(value.trim()) <= max,
      `Must be at most ${String(max)} characters.`,
    )
    .openapi({ type: 'string', minLength: 1, maxLength: max, example });

const proposalPartId = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Must be a 24-character hexadecimal id.')
  .toLowerCase()
  .openapi({ type: 'string', example: '66f0c0ffee0123456789abcd' });

const proposalPayloadSchema = z
  .strictObject({
    name: proposalText(100, 'Soportes para el taller'),
    description: proposalText(1000, 'Estantes y herramientas del taller.').optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    deadline: z.iso
      .date()
      .refine((value) => {
        const year = Number(value.slice(0, 4));
        return year >= 2000 && year <= 2099;
      }, 'The year must be between 2000 and 2099.')
      .openapi({ type: 'string', format: 'date', example: '2026-11-30' })
      .optional(),
    items: z
      .array(
        z.strictObject({
          partId: proposalPartId,
          quantity: z.number().int().min(1).max(1000),
        }),
      )
      .max(PROPOSAL_MAX_ITEMS)
      .optional(),
  })
  .openapi('ProposalCreateProjectPayload');

export const proposalSchema = z
  .strictObject({
    kind: z.literal('create_project'),
    payload: proposalPayloadSchema,
    itemNames: z
      .array(
        z.strictObject({
          partId: proposalPartId,
          name: proposalText(100, 'Soporte de estante'),
        }),
      )
      .max(PROPOSAL_MAX_ITEMS),
  })
  .superRefine((proposal, ctx) => {
    const ids = (proposal.payload.items ?? []).map((item) => item.partId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'A part appears twice.',
        path: ['payload', 'items'],
      });
    }
    const named = proposal.itemNames.map((entry) => entry.partId);
    if (new Set(named).size !== named.length || named.some((id) => !ids.includes(id))) {
      ctx.addIssue({
        code: 'custom',
        message: 'itemNames must be unique and only for parts in payload.items.',
        path: ['itemNames'],
      });
    }
  })
  .openapi('AssistantProposal', {
    description:
      'A suggested action. It is NOT executed: the browser shows it, and only after the user ' +
      'confirms does it send the payload to POST /api/v1/projects, which validates it again.',
  });

export const chatResponseSchema = z
  .strictObject({
    reply: z.string().max(MAX_REPLY_CHARACTERS).openapi({ description: 'The assistant reply.' }),
    proposal: proposalSchema.nullable(),
  })
  .openapi('ChatResponse');

/**
 * What the assistant's POST /chat answers. Parsed, never trusted. The proposal stays `unknown`
 * here: an invalid one must drop the proposal, not fail the whole reply (see the service).
 */
export const assistantReplySchema = z.object({
  reply: z.string().min(1),
  proposal: z.unknown().optional(),
});

export type ChatDto = z.infer<typeof chatResponseSchema>;
export type ProposalDto = z.infer<typeof proposalSchema>;
