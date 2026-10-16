import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PlanningSettings } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { PlanningApi } from './planning-api';

const URL = 'http://api.test/api/v1/planning/settings';
const SETTINGS: PlanningSettings = {
  batchSavingBasisPoints: 1250,
  version: 2,
  updatedAt: '2026-10-16T12:00:00.000Z',
};

describe('PlanningApi', () => {
  let api: PlanningApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(PlanningApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('gets the settings', async () => {
    const result = firstValueFrom(api.getSettings());

    http.expectOne({ method: 'GET', url: URL }).flush(SETTINGS);

    await expect(result).resolves.toEqual(SETTINGS);
  });

  it('puts the saving with its version', async () => {
    const body = { batchSavingBasisPoints: 500, version: 2 };
    const result = firstValueFrom(api.putSettings(body));

    const request = http.expectOne({ method: 'PUT', url: URL });
    expect(request.request.body).toEqual(body);
    request.flush({ ...SETTINGS, batchSavingBasisPoints: 500, version: 3 });

    await expect(result).resolves.toMatchObject({ version: 3 });
  });

  it('fails with the safe error on a 409 and does not retry', async () => {
    const result = firstValueFrom(api.putSettings({ batchSavingBasisPoints: 0, version: 1 }));

    http.expectOne(URL).flush({ detail: 'boom' }, { status: 409, statusText: 'x' });

    await expect(result).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['not an object', 'nope'],
    ['a fractional saving', { ...SETTINGS, batchSavingBasisPoints: 1.5 }],
    ['a missing version', { batchSavingBasisPoints: 0, updatedAt: null }],
    ['a numeric updatedAt', { ...SETTINGS, updatedAt: 5 }],
  ])('rejects %s as an unexpected response', async (_name, body) => {
    const result = firstValueFrom(api.getSettings());

    http.expectOne(URL).flush(body);

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });
});
