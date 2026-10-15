import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CostEstimate, CostSettings } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { CostsApi, isCostEstimate, isCostSettings } from './costs-api';

const SETTINGS_URL = 'http://api.test/api/v1/costs/settings';
const ESTIMATE_URL = 'http://api.test/api/v1/costs/estimates';

const settings: CostSettings = {
  kwhPriceMinor: 8000,
  wearPerHourMinor: 150,
  fixedPerJobMinor: 5000,
  defaultMarginBasisPoints: 2500,
  version: 2,
  updatedAt: '2026-10-15T12:00:00.000Z',
};

const estimate: CostEstimate = {
  quantity: 2,
  printSeconds: 14_400,
  filament: { grams: 200, costMinor: 400_000 },
  electricity: { watts: 270, costMinor: 8640 },
  wear: { costMinor: 600 },
  fixed: { costMinor: 5000 },
  subtotalMinor: 414_240,
  marginBasisPoints: 2500,
  marginMinor: 103_560,
  totalMinor: 517_800,
  unitTotalMinor: 258_900,
  warnings: [{ code: 'filament_insufficient' }],
};

describe('CostsApi', () => {
  let api: CostsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(CostsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('gets the settings', async () => {
    const result = firstValueFrom(api.getSettings());

    http.expectOne({ method: 'GET', url: SETTINGS_URL }).flush(settings);

    await expect(result).resolves.toEqual(settings);
  });

  it('puts the four numbers with the version last seen', async () => {
    const body = {
      kwhPriceMinor: 8000,
      wearPerHourMinor: 150,
      fixedPerJobMinor: 5000,
      defaultMarginBasisPoints: 2500,
      version: 1,
    };
    const result = firstValueFrom(api.putSettings(body));

    const request = http.expectOne({ method: 'PUT', url: SETTINGS_URL });
    expect(request.request.body).toEqual(body);
    request.flush(settings);

    await expect(result).resolves.toEqual(settings);
  });

  it('keeps the issues of a stale-version conflict on the ApiError', async () => {
    const result = firstValueFrom(
      api.putSettings({
        kwhPriceMinor: 0,
        wearPerHourMinor: 0,
        fixedPerJobMinor: 0,
        defaultMarginBasisPoints: 0,
        version: 1,
      }),
    );

    http
      .expectOne(SETTINGS_URL)
      .flush(
        { code: 'conflict', issues: [{ path: 'version', message: 'x' }] },
        { status: 409, statusText: 'Conflict' },
      );

    await expect(result).rejects.toMatchObject({
      status: 409,
      issues: [{ path: 'version', message: 'x' }],
    });
  });

  it('posts the estimate request once and never retries a failure', async () => {
    const body = { partId: 'a', filamentId: 'b', quantity: 2 };
    const result = firstValueFrom(api.estimate(body));

    const request = http.expectOne({ method: 'POST', url: ESTIMATE_URL });
    expect(request.request.body).toEqual(body);
    request.flush({ code: 'unavailable' }, { status: 503, statusText: 'Service Unavailable' });

    await expect(result).rejects.toMatchObject({ status: 503 });
    http.expectNone(ESTIMATE_URL);
  });

  it('returns the estimate when the body has the expected shape', async () => {
    const result = firstValueFrom(api.estimate({ partId: 'a', filamentId: 'b' }));

    http.expectOne(ESTIMATE_URL).flush(estimate);

    await expect(result).resolves.toEqual(estimate);
  });

  it('rejects an estimate with a fractional centavo as an unexpected response', async () => {
    const result = firstValueFrom(api.estimate({ partId: 'a', filamentId: 'b' }));

    http.expectOne(ESTIMATE_URL).flush({ ...estimate, totalMinor: 517_800.5 });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('rejects settings of the wrong shape as an unexpected response', async () => {
    const result = firstValueFrom(api.getSettings());

    http.expectOne(SETTINGS_URL).flush({ ...settings, kwhPriceMinor: '8000' });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });
});

describe('type guards', () => {
  it('accepts the settings of version 0 with no update date', () => {
    expect(isCostSettings({ ...settings, version: 0, updatedAt: null })).toBe(true);
  });

  it.each([
    ['a null body', null],
    ['a negative amount', { ...settings, wearPerHourMinor: -1 }],
    ['a fractional amount', { ...settings, kwhPriceMinor: 1.5 }],
    ['a missing version', { ...settings, version: undefined }],
    ['a numeric update date', { ...settings, updatedAt: 5 }],
  ])('rejects settings with %s', (_name, value) => {
    expect(isCostSettings(value)).toBe(false);
  });

  it('accepts an estimate with no electricity and no warnings', () => {
    expect(isCostEstimate({ ...estimate, electricity: null, warnings: [] })).toBe(true);
  });

  it.each([
    ['a null body', null],
    ['a fractional subtotal', { ...estimate, subtotalMinor: 1.25 }],
    ['a string total', { ...estimate, totalMinor: '5' }],
    ['a fractional filament cost', { ...estimate, filament: { grams: 1, costMinor: 0.5 } }],
    ['a fractional electricity cost', { ...estimate, electricity: { watts: 1, costMinor: 0.5 } }],
    ['no wear line', { ...estimate, wear: undefined }],
    ['an unknown warning code', { ...estimate, warnings: [{ code: 'surprise' }] }],
    ['warnings that are not a list', { ...estimate, warnings: 'none' }],
  ])('rejects an estimate with %s', (_name, value) => {
    expect(isCostEstimate(value)).toBe(false);
  });
});
