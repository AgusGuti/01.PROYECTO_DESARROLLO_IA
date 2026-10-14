import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { toApiError } from './api-error';

describe('toApiError', () => {
  it('maps a problem response to a Spanish message without exposing backend text', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 404,
        error: {
          code: 'not_found',
          detail: 'Part 65f0 not found in collection parts',
          requestId: 'req-12345678',
        },
      }),
    );

    expect(error.status).toBe(404);
    expect(error.code).toBe('not_found');
    expect(error.requestId).toBe('req-12345678');
    expect(error.message).toBe('No se encontró lo que buscabas.');
    expect(error.message).not.toContain('collection');
  });

  it('keeps well-formed field issues and drops malformed ones', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 400,
        error: {
          code: 'validation_failed',
          issues: [{ path: 'weightGrams', message: 'Too small' }, { path: 7 }, 'nonsense'],
        },
      }),
    );

    expect(error.issues).toEqual([{ path: 'weightGrams', message: 'Too small' }]);
  });

  it('reports a network failure distinctly', () => {
    const error = toApiError(
      new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }),
    );

    expect(error.code).toBe('network_error');
    expect(error.message).toContain('No se pudo conectar');
  });

  it('falls back to a generic message and the header request id for a non-JSON error', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 502,
        error: '<html>Bad Gateway</html>',
        headers: new HttpHeaders({ 'X-Request-Id': 'req-from-header' }),
      }),
    );

    expect(error.code).toBe('unknown');
    expect(error.requestId).toBe('req-from-header');
    expect(error.message).toBe('Ocurrió un error inesperado. Intentá de nuevo.');
  });
});
