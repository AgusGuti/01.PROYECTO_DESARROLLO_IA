// Validated service result -> response DTO. Fields are copied one by one.
import type { ChatDto, ProposalDto } from './chat.schemas.js';

function toProposalDto(proposal: ProposalDto): ProposalDto {
  if (proposal.kind === 'create_queue') {
    const { projectId, goal, mode, printerIds } = proposal.payload;
    return {
      kind: proposal.kind,
      payload: { projectId, goal, mode, printerIds: [...printerIds] },
      projectName: proposal.projectName,
      printerNames: proposal.printerNames.map(({ printerId, name }) => ({ printerId, name })),
    };
  }
  return {
    kind: proposal.kind,
    payload: proposal.payload,
    itemNames: proposal.itemNames.map(({ partId, name }) => ({ partId, name })),
  };
}

export function toChatDto({ reply, proposal }: ChatDto): ChatDto {
  return {
    reply,
    proposal: proposal === null ? null : toProposalDto(proposal),
  };
}
