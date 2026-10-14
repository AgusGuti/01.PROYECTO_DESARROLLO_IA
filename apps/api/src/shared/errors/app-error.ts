// Typed application errors (standard §6.3). Services and domain code throw these;
// the central error handler is the only place that turns them into HTTP responses.

export const ERROR_DEFINITIONS = {
  validation_failed: { status: 400, title: 'Invalid request' },
  unauthenticated: { status: 401, title: 'Authentication required' },
  forbidden: { status: 403, title: 'Not allowed' },
  not_found: { status: 404, title: 'Not found' },
  conflict: { status: 409, title: 'Conflict' },
  payload_too_large: { status: 413, title: 'Request too large' },
  rate_limited: { status: 429, title: 'Too many requests' },
  internal: { status: 500, title: 'Internal error' },
  service_unavailable: { status: 503, title: 'Service unavailable' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export const ERROR_CODES = Object.keys(ERROR_DEFINITIONS) as [ErrorCode, ...ErrorCode[]];

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly title: string;
  readonly issues: readonly FieldIssue[];

  constructor(
    readonly code: ErrorCode,
    /** Safe to show to the client. Never put internal details, queries or stack traces here. */
    detail: string,
    options: { issues?: readonly FieldIssue[]; cause?: unknown } = {},
  ) {
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.status = ERROR_DEFINITIONS[code].status;
    this.title = ERROR_DEFINITIONS[code].title;
    this.issues = options.issues ?? [];
  }
}
