import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AssistantProposal,
  ChatRequest,
  CreateProjectRequest,
  CreateQueueRequest,
  Project,
  Queue,
} from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';

export type Proposal = NonNullable<AssistantProposal>;

export interface ChatReply {
  readonly reply: string;
  readonly proposal: Proposal | null;
}

const PRIORITIES: readonly unknown[] = ['low', 'normal', 'high', 'urgent'];

const GOALS: readonly unknown[] = ['deadline', 'fastest', 'minimal_idle'];
const MODES: readonly unknown[] = ['single', 'multi'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasField(value: unknown, key: string, type: 'string' | 'number'): boolean {
  return isRecord(value) && typeof value[key] === type;
}

function isQueueProposal(value: Record<string, unknown>): boolean {
  const payload = value['payload'];
  if (!isRecord(payload) || typeof payload['projectId'] !== 'string') return false;
  if (!GOALS.includes(payload['goal']) || !MODES.includes(payload['mode'])) return false;
  const ids = payload['printerIds'];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return false;
  const names = value['printerNames'];
  return (
    typeof value['projectName'] === 'string' &&
    Array.isArray(names) &&
    names.every((n) => hasField(n, 'printerId', 'string') && hasField(n, 'name', 'string'))
  );
}

/**
 * Runtime check of a proposal's SHAPE only (standard §9.3). Bounds were validated by the API
 * when it built the proposal, and POST /projects validates again on confirm.
 */
export function isProposal(value: unknown): value is Proposal {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'create_queue') return isQueueProposal(value);
  if (value['kind'] !== 'create_project') return false;
  const payload = value['payload'];
  if (!isRecord(payload) || typeof payload['name'] !== 'string') return false;
  if (payload['description'] !== undefined && typeof payload['description'] !== 'string') {
    return false;
  }
  if (payload['priority'] !== undefined && !PRIORITIES.includes(payload['priority'])) return false;
  const deadline = payload['deadline'];
  if (
    deadline !== undefined &&
    !(typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline))
  ) {
    return false;
  }
  const items = payload['items'];
  if (
    items !== undefined &&
    !(
      Array.isArray(items) &&
      items.every((i) => hasField(i, 'partId', 'string') && hasField(i, 'quantity', 'number'))
    )
  ) {
    return false;
  }
  const names = value['itemNames'];
  return (
    Array.isArray(names) &&
    names.every((n) => hasField(n, 'partId', 'string') && hasField(n, 'name', 'string'))
  );
}

/** Runtime check: `HttpClient` only claims the body shape (standard §9.3). `proposal` stays unknown. */
export function isChatResponse(value: unknown): value is { reply: string; proposal?: unknown } {
  return hasField(value, 'reply', 'string');
}

/** Runtime check of the created project returned by POST /api/v1/projects. */
export function isCreatedProject(value: unknown): value is Project {
  return hasField(value, 'id', 'string') && hasField(value, 'name', 'string');
}

/** Runtime check of the created queue returned by POST /api/v1/queues. */
export function isCreatedQueue(value: unknown): value is Queue {
  return hasField(value, 'projectId', 'string') && hasField(value, 'goal', 'string');
}

@Injectable({ providedIn: 'root' })
export class ChatApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * A POST that spends model time: never retried automatically, the user decides.
   * Decision: a malformed `proposal` is treated as "no proposal" and the reply is kept. The
   * reply is still valid text, and a card built from a doubtful payload would be worse than none.
   */
  ask(message: string): Observable<ChatReply> {
    const body: ChatRequest = { message };
    return this.http.post<unknown>(`${this.baseUrl}/api/v1/chat`, body).pipe(
      map((response) => {
        if (!isChatResponse(response)) {
          throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
        }
        return {
          reply: response.reply,
          proposal: isProposal(response.proposal) ? response.proposal : null,
        };
      }),
    );
  }

  /** Sends a confirmed queue proposal. Not idempotent: never retried automatically. */
  createQueue(payload: CreateQueueRequest): Observable<Queue> {
    return this.http.post<unknown>(`${this.baseUrl}/api/v1/queues`, payload).pipe(
      map((response) => {
        if (!isCreatedQueue(response)) {
          throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
        }
        return response;
      }),
    );
  }

  /** Sends a confirmed proposal. Not idempotent: never retried automatically. */
  createProject(payload: CreateProjectRequest): Observable<Project> {
    return this.http.post<unknown>(`${this.baseUrl}/api/v1/projects`, payload).pipe(
      map((response) => {
        if (!isCreatedProject(response)) {
          throw new ApiError(200, 'unexpected_response', 'El servidor respondió algo inesperado.');
        }
        return response;
      }),
    );
  }
}
