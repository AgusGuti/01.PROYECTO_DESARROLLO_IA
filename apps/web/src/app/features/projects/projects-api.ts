import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CreateProjectRequest,
  ListProjectsData,
  Project,
  ProjectItem,
  ProjectList,
  ProjectSummary,
  UpdateProjectRequest,
} from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { isMaterial, isPriority } from './project-labels';

export type ListProjectsQuery = NonNullable<ListProjectsData['query']>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function narrow<T>(guard: (value: unknown) => value is T): (body: unknown) => T {
  return (body) => {
    if (!guard(body)) {
      throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
    }
    return body;
  };
}

function isProjectItem(value: unknown): value is ProjectItem {
  if (!isRecord(value)) return false;
  const part = value['part'];
  return (
    typeof value['partId'] === 'string' &&
    isWholeNumber(value['quantity']) &&
    (part === null ||
      (isRecord(part) && typeof part['name'] === 'string' && isMaterial(part['material'])))
  );
}

/**
 * Type guards. `HttpClient` only *claims* a body has a given type; nothing checks it. These
 * functions are the runtime check (standard §9.3).
 */
export function isProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    isNullableString(value['description']) &&
    isPriority(value['priority']) &&
    isNullableString(value['deadline']) &&
    Array.isArray(value['items']) &&
    value['items'].every(isProjectItem) &&
    isWholeNumber(value['version']) &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string' &&
    isNullableString(value['description']) &&
    isPriority(value['priority']) &&
    isNullableString(value['deadline']) &&
    isWholeNumber(value['itemCount']) &&
    isWholeNumber(value['unitCount']) &&
    typeof value['createdAt'] === 'string' &&
    typeof value['updatedAt'] === 'string'
  );
}

export function isProjectList(value: unknown): value is ProjectList {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isProjectSummary) &&
    isWholeNumber(value['page']) &&
    isWholeNumber(value['pageSize']) &&
    isWholeNumber(value['total'])
  );
}

@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private get collectionUrl(): string {
    return `${this.baseUrl}/api/v1/projects`;
  }

  private itemUrl(id: string): string {
    return `${this.collectionUrl}/${encodeURIComponent(id)}`;
  }

  list(query: ListProjectsQuery = {}): Observable<ProjectList> {
    let params = new HttpParams();
    if (query.page !== undefined) params = params.set('page', query.page);
    if (query.pageSize !== undefined) params = params.set('pageSize', query.pageSize);
    if (query.priority !== undefined) params = params.set('priority', query.priority);
    if (query.sort !== undefined) params = params.set('sort', query.sort);
    if (query.order !== undefined) params = params.set('order', query.order);

    return this.http.get<unknown>(this.collectionUrl, { params }).pipe(map(narrow(isProjectList)));
  }

  get(id: string): Observable<Project> {
    return this.http.get<unknown>(this.itemUrl(id)).pipe(map(narrow(isProject)));
  }

  /** Not idempotent (two POSTs make two projects): never retried automatically. */
  create(body: CreateProjectRequest): Observable<Project> {
    return this.http.post<unknown>(this.collectionUrl, body).pipe(map(narrow(isProject)));
  }

  /** `body.version` is the version the caller last saw (ADR 0008). */
  update(id: string, body: UpdateProjectRequest): Observable<Project> {
    return this.http.patch<unknown>(this.itemUrl(id), body).pipe(map(narrow(isProject)));
  }

  /** Answers 204. A second DELETE answers 404. */
  remove(id: string): Observable<void> {
    return this.http.delete<unknown>(this.itemUrl(id)).pipe(map(() => undefined));
  }
}
