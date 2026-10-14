// Central error handling (standard §6.3): one place decides what a client may see.
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../errors/app-error.js';
import { PROBLEM_CONTENT_TYPE, toProblem } from './problem.js';
import { requestIdOf } from './request-id.js';

/** Errors raised by the Express body parser carry a `type` string. */
function bodyParserErrorType(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'type' in error) {
    return typeof error.type === 'string' ? error.type : undefined;
  }
  return undefined;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const parserError = bodyParserErrorType(error);
  if (parserError === 'entity.too.large') {
    return new AppError('payload_too_large', 'The request body is too large.', { cause: error });
  }
  if (parserError === 'entity.parse.failed') {
    return new AppError('validation_failed', 'The request body is not valid JSON.', {
      cause: error,
    });
  }
  // Unknown failure: the client gets a generic message, the details go to the log only.
  return new AppError('internal', 'An unexpected error occurred.', { cause: error });
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('not_found', 'The requested resource does not exist.'));
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // Express recognises an error handler by its four parameters, so `_next` must stay.
  return (error: unknown, req, res, _next) => {
    const appError = toAppError(error);
    const requestId = requestIdOf(req);

    if (appError.status >= 500) {
      logger.error({ err: error, requestId, code: appError.code }, 'request failed');
    }

    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(appError.status).type(PROBLEM_CONTENT_TYPE).json(toProblem(appError, requestId));
  };
}
