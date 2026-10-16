import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { InterventionSchedule } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { AvailabilityApi, isInterventionSchedule } from './availability-api';

const URL = 'http://api.test/api/v1/availability/schedule';

const day = { ranges: [{ startMinute: 480, endMinute: 1080 }] };
const schedule: InterventionSchedule = {
  weekly: [day, day, day, day, day, day, day],
  exceptions: [{ date: '2026-12-25', ranges: [] }],
  version: 2,
  updatedAt: '2026-10-15T12:00:00.000Z',
};

describe('AvailabilityApi', () => {
  let api: AvailabilityApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(AvailabilityApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('gets the schedule', async () => {
    const result = firstValueFrom(api.getSchedule());

    http.expectOne({ method: 'GET', url: URL }).flush(schedule);

    await expect(result).resolves.toEqual(schedule);
  });

  it('puts the full replacement with the version last seen', async () => {
    const body = { weekly: schedule.weekly, exceptions: schedule.exceptions, version: 2 };
    const result = firstValueFrom(api.putSchedule(body));

    const request = http.expectOne({ method: 'PUT', url: URL });
    expect(request.request.body).toEqual(body);
    request.flush(schedule);

    await expect(result).resolves.toEqual(schedule);
  });

  it('rejects a body that is not a schedule', async () => {
    const result = firstValueFrom(api.getSchedule());

    http.expectOne(URL).flush({ weekly: [] });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('keeps the issues of a stale-version conflict and never retries', async () => {
    const result = firstValueFrom(api.putSchedule({ weekly: [], exceptions: [], version: 1 }));

    http
      .expectOne(URL)
      .flush(
        { code: 'conflict', issues: [{ path: 'version', message: 'x' }] },
        { status: 409, statusText: 'Conflict' },
      );

    await expect(result).rejects.toMatchObject({
      status: 409,
      issues: [{ path: 'version', message: 'x' }],
    });
  });

  it.each([
    [{ ...schedule, weekly: schedule.weekly.slice(0, 6) }, false],
    [{ ...schedule, version: -1 }, false],
    [{ ...schedule, exceptions: [{ date: 5, ranges: [] }] }, false],
    [{ ...schedule, weekly: [{ ranges: [{ startMinute: '1', endMinute: 2 }] }] }, false],
    [schedule, true],
  ])('guards %#', (value, expected) => {
    expect(isInterventionSchedule(value)).toBe(expected);
  });
});
