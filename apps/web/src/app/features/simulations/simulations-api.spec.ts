import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Optimization, Simulation } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { SimulationsApi } from './simulations-api';

const SIMULATION: Simulation = {
  projectId: 'p1',
  goal: 'deadline',
  startAt: '2026-10-16T10:00',
  jobs: [
    {
      order: 1,
      partId: 'a',
      partName: 'Soporte',
      unit: 1,
      unitsInLine: 2,
      printerId: 'pr1',
      startAt: '2026-10-16T10:00',
      endAt: '2026-10-16T12:00',
      handoffAt: '2026-10-16T12:30',
      unattended: false,
    },
  ],
  printers: [{ printerId: 'pr1', name: 'Ender', jobs: 1, busyMinutes: 150, idleMinutes: 0 }],
  totals: {
    placedJobs: 1,
    unplacedJobs: 0,
    finishAt: '2026-10-16T12:30',
    totalBusyMinutes: 150,
    totalIdleMinutes: 0,
  },
  deadline: { date: null, met: null },
  unplaced: [],
  warnings: [],
};

describe('SimulationsApi', () => {
  let api: SimulationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(SimulationsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('posts the request and returns the simulation', async () => {
    const body = { projectId: 'p1', startAt: '2026-10-16T10:00' };
    const result = firstValueFrom(api.simulate(body));

    const request = http.expectOne({ method: 'POST', url: 'http://api.test/api/v1/simulations' });
    expect(request.request.body).toEqual(body);
    request.flush(SIMULATION);

    await expect(result).resolves.toEqual(SIMULATION);
  });

  it('fails with the safe error on a 503 and does not retry', async () => {
    const result = firstValueFrom(api.simulate({ projectId: 'p1', startAt: '2026-10-16T10:00' }));

    http
      .expectOne('http://api.test/api/v1/simulations')
      .flush({ detail: 'boom' }, { status: 503, statusText: 'x' });

    await expect(result).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    ['not an object', 'nope'],
    ['an unknown goal', { ...SIMULATION, goal: 'whenever' }],
    ['a job without a flag', { ...SIMULATION, jobs: [{ ...SIMULATION.jobs[0], unattended: 1 }] }],
    [
      'a fractional minute count',
      { ...SIMULATION, printers: [{ ...SIMULATION.printers[0], idleMinutes: 1.5 }] },
    ],
    ['missing totals', { ...SIMULATION, totals: null }],
    ['an unknown warning', { ...SIMULATION, warnings: [{ code: 'surprise' }] }],
  ])('rejects %s as an unexpected response', async (_name, body) => {
    const result = firstValueFrom(api.simulate({ projectId: 'p1', startAt: '2026-10-16T10:00' }));

    http.expectOne('http://api.test/api/v1/simulations').flush(body);

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  describe('optimize', () => {
    const URL = 'http://api.test/api/v1/simulations/optimizations';
    const totals = {
      placedPlates: 1,
      placedUnits: 2,
      unplacedUnits: 0,
      finishAt: '2026-10-16T12:30',
      totalBusyMinutes: 150,
      totalIdleMinutes: 0,
    };
    const deadline = { date: null, met: null };
    const OPTIMIZATION: Optimization = {
      projectId: 'p1',
      goal: 'fastest',
      startAt: '2026-10-16T10:00',
      strategy: 'queue_order',
      baseline: { totals: { ...totals, placedPlates: 2 }, deadline, unplaced: [] },
      optimized: {
        jobs: [
          {
            order: 1,
            partId: 'a',
            partName: 'Soporte',
            units: 2,
            plateIndex: 1,
            platesInLine: 1,
            printerId: 'pr1',
            startAt: '2026-10-16T10:00',
            endAt: '2026-10-16T12:00',
            handoffAt: '2026-10-16T12:30',
            unattended: false,
          },
        ],
        printers: [{ printerId: 'pr1', name: 'Ender', jobs: 1, busyMinutes: 150, idleMinutes: 0 }],
        totals,
        deadline,
        unplaced: [],
      },
      comparison: { finishDeltaMinutes: null, idleDeltaMinutes: 0, deadlineChanged: 'unknown' },
      candidates: [
        {
          strategy: 'naive',
          finishAt: '2026-10-16T12:30',
          totalIdleMinutes: 0,
          deadlineMet: null,
          placedUnits: 2,
          unplacedUnits: 0,
        },
      ],
      warnings: [{ code: 'batching_applied' }],
    };
    const body = { projectId: 'p1', startAt: '2026-10-16T10:00' };

    it('posts the request and returns the optimisation', async () => {
      const result = firstValueFrom(api.optimize(body));

      const request = http.expectOne({ method: 'POST', url: URL });
      expect(request.request.body).toEqual(body);
      request.flush(OPTIMIZATION);

      await expect(result).resolves.toEqual(OPTIMIZATION);
    });

    it('fails with the safe error on a 503 and does not retry', async () => {
      const result = firstValueFrom(api.optimize(body));

      http.expectOne(URL).flush({ detail: 'boom' }, { status: 503, statusText: 'x' });

      await expect(result).rejects.toMatchObject({ status: 503 });
    });

    it.each([
      ['not an object', 'nope'],
      ['an unknown strategy', { ...OPTIMIZATION, strategy: 'magic' }],
      ['an unknown goal', { ...OPTIMIZATION, goal: 'whenever' }],
      [
        'a plate without units',
        { ...OPTIMIZATION, optimized: { ...OPTIMIZATION.optimized, jobs: [{ order: 1 }] } },
      ],
      [
        'a fractional delta',
        { ...OPTIMIZATION, comparison: { ...OPTIMIZATION.comparison, idleDeltaMinutes: 1.5 } },
      ],
      [
        'an unknown deadline change',
        { ...OPTIMIZATION, comparison: { ...OPTIMIZATION.comparison, deadlineChanged: 'maybe' } },
      ],
      [
        'a candidate with an unknown strategy',
        { ...OPTIMIZATION, candidates: [{ strategy: 'magic' }] },
      ],
      ['a baseline without totals', { ...OPTIMIZATION, baseline: { deadline, unplaced: [] } }],
      ['an unknown warning', { ...OPTIMIZATION, warnings: [{ code: 'surprise' }] }],
    ])('rejects %s as an unexpected response', async (_name, response) => {
      const result = firstValueFrom(api.optimize(body));

      http.expectOne(URL).flush(response);

      await expect(result).rejects.toBeInstanceOf(ApiError);
      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });
  });
});
