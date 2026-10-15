// Internal project -> response DTO. Fields are copied one by one, so a field added to the internal
// model later (such as `deletedAt`) cannot leak into the API by accident.
import {
  summarise,
  type Project,
  type ProjectDetail,
  type ProjectPage,
} from './projects.domain.js';
import type { ProjectDto, ProjectListDto, ProjectSummaryDto } from './projects.schemas.js';

/** `YYYY-MM-DD` of a UTC-midnight date (ADR 0011). */
const toDay = (deadline: Date | null): string | null =>
  deadline === null ? null : deadline.toISOString().slice(0, 10);

export function toProjectDto({ project, parts }: ProjectDetail): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    priority: project.priority,
    deadline: toDay(project.deadline),
    items: project.items.map((item) => {
      const part = parts.get(item.partId);
      return {
        partId: item.partId,
        quantity: item.quantity,
        part: part === undefined ? null : { name: part.name, material: part.material },
      };
    }),
    version: project.version,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toSummaryDto(project: Project): ProjectSummaryDto {
  const { itemCount, unitCount } = summarise(project.items);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    priority: project.priority,
    deadline: toDay(project.deadline),
    itemCount,
    unitCount,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toProjectListDto(
  result: ProjectPage,
  paging: { page: number; pageSize: number },
): ProjectListDto {
  return {
    items: result.items.map(toSummaryDto),
    page: paging.page,
    pageSize: paging.pageSize,
    total: result.total,
  };
}
