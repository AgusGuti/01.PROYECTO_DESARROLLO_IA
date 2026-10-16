// Validated service result -> response DTO. Fields are copied one by one.
import type { ChatDto } from './chat.schemas.js';

export function toChatDto({ reply, proposal }: ChatDto): ChatDto {
  return {
    reply,
    proposal:
      proposal === null
        ? null
        : {
            kind: proposal.kind,
            payload: proposal.payload,
            itemNames: proposal.itemNames.map(({ partId, name }) => ({ partId, name })),
          },
  };
}
