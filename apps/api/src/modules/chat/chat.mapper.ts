// Validated service result -> response DTO. Fields are copied one by one.
import type { ChatDto, GcodeImportResultDto, ProposalDto } from './chat.schemas.js';

const toLineName = ({
  partId,
  filamentId,
  name,
  filamentName,
}: {
  partId: string;
  filamentId: string;
  name: string;
  filamentName: string;
}) => ({ partId, filamentId, name, filamentName });

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
        lines: lines.map(({ partId, filamentId, quantity, completed }) => ({
          partId,
          filamentId,
          quantity,
          completed,
        })),
      },
      projectName: proposal.projectName,
      lineNames: proposal.lineNames.map(toLineName),
    };
  }
  if (proposal.kind === 'import_gcodes') {
    const { material, folder } = proposal.payload;
    return {
      kind: proposal.kind,
      payload: folder === undefined ? { material } : { material, folder },
    };
  }
  const { name, description, priority, deadline, items } = proposal.payload;
  return {
    kind: proposal.kind,
    payload: {
      name,
      ...(description === undefined ? {} : { description }),
      ...(priority === undefined ? {} : { priority }),
      ...(deadline === undefined ? {} : { deadline }),
      ...(items === undefined
        ? {}
        : {
            items: items.map(({ partId, filamentId, quantity }) => ({
              partId,
              filamentId,
              quantity,
            })),
          }),
    },
    itemNames: proposal.itemNames.map(toLineName),
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
