import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { GcodeAnalysis } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { GcodeAnalysisApi, isGcodeAnalysis } from './gcode-analysis-api';

const analysis: GcodeAnalysis = {
  slicer: 'cura',
  estimatedPrintSeconds: 7380,
  filamentMm: 8123,
  filamentGrams: 24,
  layerHeightUm: 200,
  dimensionsMm: { x: 40, y: 30, z: 20 },
  targetMachineName: 'Ender 3',
  warnings: [{ code: 'GRAMS_FROM_DENSITY_TABLE' }],
};
const URL = 'http://api.test/api/v1/gcode-analyses';

describe('GcodeAnalysisApi', () => {
  let api: GcodeAnalysisApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(GcodeAnalysisApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('posts the head untouched together with the material', async () => {
    const head = '  ;FLAVOR:Marlin\r\n;TIME:6666  \n';
    const result = firstValueFrom(api.analyse(head, 'PETG'));

    const request = http.expectOne({ method: 'POST', url: URL });
    expect(request.request.body).toEqual({ head, material: 'PETG' });
    request.flush(analysis);

    await expect(result).resolves.toEqual(analysis);
  });

  it('omits the material from the body when none was given', async () => {
    const result = firstValueFrom(api.analyse(';x'));

    const request = http.expectOne({ method: 'POST', url: URL });
    expect(request.request.body).toEqual({ head: ';x' });
    request.flush({ ...analysis, filamentGrams: null });

    await expect(result).resolves.toMatchObject({ filamentGrams: null });
  });

  it('maps a 400 on head to an ApiError that keeps the issue path', async () => {
    const result = firstValueFrom(api.analyse('nope', 'PLA'));

    http.expectOne(URL).flush(
      {
        code: 'validation_failed',
        detail: 'backend text',
        issues: [{ path: 'head', message: 'Unsupported.' }],
      },
      { status: 400, statusText: 'Bad Request' },
    );

    const error: unknown = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, issues: [{ path: 'head' }] });
  });

  it('does not retry on its own after a failure', async () => {
    const result = firstValueFrom(api.analyse(';x', 'PLA'));

    http.expectOne(URL).flush(null, { status: 503, statusText: 'Unavailable' });

    await expect(result).rejects.toBeInstanceOf(ApiError);
    http.expectNone(URL);
  });

  it('rejects a response that is not an analysis', async () => {
    const result = firstValueFrom(api.analyse(';x', 'PLA'));

    http.expectOne(URL).flush({ ok: true });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });
});

describe('isGcodeAnalysis', () => {
  it('accepts a complete analysis and one with every optional value null', () => {
    expect(isGcodeAnalysis(analysis)).toBe(true);
    expect(
      isGcodeAnalysis({
        ...analysis,
        filamentGrams: null,
        layerHeightUm: null,
        dimensionsMm: null,
        targetMachineName: null,
        warnings: [],
      }),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['another slicer', { ...analysis, slicer: 'prusa' }],
    ['fractional seconds', { ...analysis, estimatedPrintSeconds: 1.5 }],
    ['NaN filament length', { ...analysis, filamentMm: Number.NaN }],
    ['grams as text', { ...analysis, filamentGrams: '24' }],
    ['partial dimensions', { ...analysis, dimensionsMm: { x: 1, y: 2 } }],
    ['an unknown warning code', { ...analysis, warnings: [{ code: 'BRAND_NEW' }] }],
    ['warnings that are not records', { ...analysis, warnings: ['GRAMS_FROM_DENSITY_TABLE'] }],
    ['a missing machine name', { ...analysis, targetMachineName: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(isGcodeAnalysis(value)).toBe(false);
  });
});
