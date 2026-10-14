import type { HttpErrorResponse } from '@angular/common/http';

export interface ApiFieldIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * What the rest of the app sees when a request fails. The message is written here, in Spanish,
 * for the user; the backend's own text is never shown (standard §9.3).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Stable machine-readable code from the API, or a local one for network failures. */
    readonly code: string,
    userMessage: string,
    readonly issues: readonly ApiFieldIssue[] = [],
    readonly requestId: string | null = null,
    /** The raw response body. Untrusted: narrow it with a type guard before use. */
    readonly body: unknown = null,
  ) {
    super(userMessage);
    this.name = 'ApiError';
  }
}

const MESSAGES: Readonly<Record<number, string>> = {
  0: 'No se pudo conectar con el servidor. Verificá tu conexión e intentá de nuevo.',
  400: 'Los datos enviados no son válidos. Revisalos e intentá de nuevo.',
  401: 'Necesitás iniciar sesión para continuar.',
  403: 'No tenés permiso para realizar esta acción.',
  404: 'No se encontró lo que buscabas.',
  409: 'Los datos cambiaron mientras trabajabas. Actualizá la página e intentá de nuevo.',
  413: 'El contenido enviado es demasiado grande.',
  429: 'Demasiadas solicitudes. Esperá un momento e intentá de nuevo.',
  503: 'El servicio no está disponible en este momento. Intentá de nuevo más tarde.',
};
const FALLBACK_MESSAGE = 'Ocurrió un error inesperado. Intentá de nuevo.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readIssues(body: unknown): ApiFieldIssue[] {
  if (!isRecord(body) || !Array.isArray(body['issues'])) return [];
  return body['issues'].flatMap((issue: unknown) =>
    isRecord(issue) && typeof issue['path'] === 'string' && typeof issue['message'] === 'string'
      ? [{ path: issue['path'], message: issue['message'] }]
      : [],
  );
}

export function toApiError(response: HttpErrorResponse): ApiError {
  const body: unknown = response.error;
  const code = isRecord(body) && typeof body['code'] === 'string' ? body['code'] : 'unknown';
  const requestId =
    isRecord(body) && typeof body['requestId'] === 'string'
      ? body['requestId']
      : response.headers.get('X-Request-Id');

  return new ApiError(
    response.status,
    response.status === 0 ? 'network_error' : code,
    MESSAGES[response.status] ?? FALLBACK_MESSAGE,
    readIssues(body),
    requestId,
    body,
  );
}
