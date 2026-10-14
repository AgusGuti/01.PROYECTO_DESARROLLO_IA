import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Readiness } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { StatusApi } from './status-api';

const ready: Readiness = {
  status: 'ready',
  checks: { database: 'up' },
  timestamp: '2026-01-01T12:00:00.000Z',
};
const notReady: Readiness = { ...ready, status: 'not_ready', checks: { database: 'down' } };

describe('StatusApi', () => {
  let api: StatusApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(StatusApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('requests the readiness probe from the configured base URL', async () => {
    const result = firstValueFrom(api.readiness());

    http.expectOne({ method: 'GET', url: 'http://api.test/health/ready' }).flush(ready);

    await expect(result).resolves.toEqual(ready);
  });

  it('treats a 503 readiness body as an answer, not a failure', async () => {
    const result = firstValueFrom(api.readiness());

    http
      .expectOne('http://api.test/health/ready')
      .flush(notReady, { status: 503, statusText: 'Service Unavailable' });

    await expect(result).resolves.toEqual(notReady);
  });

  it('rejects a 200 response that does not match the contract', async () => {
    const result = firstValueFrom(api.readiness());

    http.expectOne('http://api.test/health/ready').flush({ status: 'fine' });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('fails with an ApiError when the server cannot be reached', async () => {
    const result = firstValueFrom(api.readiness());

    http.expectOne('http://api.test/health/ready').error(new ProgressEvent('error'));

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ code: 'network_error' });
  });
});
