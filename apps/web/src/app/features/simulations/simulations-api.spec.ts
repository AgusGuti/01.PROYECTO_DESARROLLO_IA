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
      filamentId: 'f1',
      filamentName: 'PLA negro',
      setupMinutes: 0,
      filamentChanged: false,
    },
  ],
  printers: [
    {
      printerId: 'pr1',
      name: 'Ender',
      jobs: 1,
      busyMinutes: 150,
      idleMinutes: 0,
      setupMinutes: 0,
      filamentChanges: 0,
    },
  ],
  totals: {
    placedJobs: 1,
    unplacedJobs: 0,
    finishAt: '2026-10-16T12:30',
    totalBusyMinutes: 150,
    totalIdleMinutes: 0,
    totalSetupMinutes: 0,
    filamentChanges: 0,
  },
  deadline: { date: null, met: null },
  unplaced: [],
  warnings: [],
  filamentShortfalls: [],
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
    [
      'a job without setupMinutes',
      { ...SIMULATION, jobs: [{ ...SIMULATION.jobs[0], setupMinutes: undefined }] },
    ],
    [
      'a job without filamentChanged',
      { ...SIMULATION, jobs: [{ ...SIMULATION.jobs[0], filamentChanged: undefined }] },
    ],
    [
      'a job without a filament name',
      { ...SIMULATION, jobs: [{ ...SIMULATION.jobs[0], filamentName: undefined }] },
    ],
    [
      'a printer without filamentChanges',
      { ...SIMULATION, printers: [{ ...SIMULATION.printers[0], filamentChanges: undefined }] },
    ],
    [
      'totals without totalSetupMinutes',
      { ...SIMULATION, totals: { ...SIMULATION.totals, totalSetupMinutes: undefined } },
    ],
    [
      'totals without filamentChanges',
      { ...SIMULATION, totals: { ...SIMULATION.totals, filamentChanges: undefined } },
    ],
    ['missing filamentShortfalls', { ...SIMULATION, filamentShortfalls: undefined }],
    ['a malformed shortfall', { ...SIMULATION, filamentShortfalls: [{ filamentId: 'f1' }] }],
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
      totalSetupMinutes: 0,
      filamentChanges: 0,
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
            filamentId: 'f1',
            filamentName: 'PLA negro',
            setupMinutes: 0,
            filamentChanged: false,
          },
        ],
        printers: [
          {
            printerId: 'pr1',
            name: 'Ender',
            jobs: 1,
            busyMinutes: 150,
            idleMinutes: 0,
            setupMinutes: 0,
            filamentChanges: 0,
          },
        ],
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
          totalSetupMinutes: 0,
          filamentChanges: 0,
          deadlineMet: null,
          placedUnits: 2,
          unplacedUnits: 0,
        },
      ],
      warnings: [{ code: 'batching_applied' }],
      filamentShortfalls: [],
    };
    const body = { projectId: 'p1', startAt: '2026-10-16T10:00' };

    it('posts the request and returns the optimisation', async () => {
      const result = firstValueFrom(api.optimize(body));

      const request = http.expectOne({ method: 'POST', url: URL });
      expect(request.request.body).toEqual(body);
      request.flush(OPTIMIZATION);

      await expect(result).resolves.toEqual(OPTIMIZATION);
    });

    it('accepts the group_by_spool strategy and the filament warnings', async () => {
      const full: Optimization = {
        ...OPTIMIZATION,
        strategy: 'group_by_spool',
        warnings: [{ code: 'filament_insufficient' }, { code: 'filament_deleted' }],
        filamentShortfalls: [
          {
            filamentId: 'f1',
            name: 'PLA negro',
            availableGrams: 100,
            neededGrams: 220.5,
            completablePieces: 3,
            remainingPieces: 2,
          },
        ],
      };
      const result = firstValueFrom(api.optimize(body));

      http.expectOne(URL).flush(full);

      await expect(result).resolves.toEqual(full);
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
      [
        'a plate without setupMinutes',
        {
          ...OPTIMIZATION,
          optimized: {
            ...OPTIMIZATION.optimized,
            jobs: [{ ...OPTIMIZATION.optimized.jobs[0], setupMinutes: undefined }],
          },
        },
      ],
      [
        'baseline totals without totalSetupMinutes',
        {
          ...OPTIMIZATION,
          baseline: {
            ...OPTIMIZATION.baseline,
            totals: { ...OPTIMIZATION.baseline.totals, totalSetupMinutes: undefined },
          },
        },
      ],
      [
        'optimised totals without filamentChanges',
        {
          ...OPTIMIZATION,
          optimized: {
            ...OPTIMIZATION.optimized,
            totals: { ...OPTIMIZATION.optimized.totals, filamentChanges: undefined },
          },
        },
      ],
      [
        'a candidate without totalSetupMinutes',
        {
          ...OPTIMIZATION,
          candidates: [{ ...OPTIMIZATION.candidates[0], totalSetupMinutes: undefined }],
        },
      ],
      ['missing filamentShortfalls', { ...OPTIMIZATION, filamentShortfalls: undefined }],
    ])('rejects %s as an unexpected response', async (_name, response) => {
      const result = firstValueFrom(api.optimize(body));

      http.expectOne(URL).flush(response);

      await expect(result).rejects.toBeInstanceOf(ApiError);
      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });
  });
});
