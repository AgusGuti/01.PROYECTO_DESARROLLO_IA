// Validated service result -> response DTO. Fields are copied one by one.
import type { ChatDto, GcodeImportResultDto, ProposalDto } from './chat.schemas.js';

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
  if (proposal.kind === 'update_queue_progress') {
    const { projectId, version, lines } = proposal.payload;
    return {
      kind: proposal.kind,
      payload: {
        projectId,
        version,
        lines: lines.map(({ partId, quantity, completed }) => ({ partId, quantity, completed })),
      },
      projectName: proposal.projectName,
      lineNames: proposal.lineNames.map(({ partId, name }) => ({ partId, name })),
    };
  }
  if (proposal.kind === 'import_gcodes') {
    const { material, folder } = proposal.payload;
    return {
      kind: proposal.kind,
      payload: folder === undefined ? { material } : { material, folder },
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

export function toGcodeImportDto(result: GcodeImportResultDto): GcodeImportResultDto {
  const { created, updated, unchanged, skipped, errors } = result;
  return { created, updated, unchanged, skipped, errors };
}
