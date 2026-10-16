import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Simulation } from '@print3d/api-contracts';
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
});
