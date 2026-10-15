import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Printer, PrinterList } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { isPrinter, PrintersApi } from './printers-api';

const printer: Printer = {
  id: '66f0c0ffee0123456789abcd',
  name: 'Ender 3 Pro',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.2, material: 'brass' },
  compatibleMaterials: ['PLA', 'PETG'],
  typicalSpeedMmS: null,
  powerWatts: null,
  status: 'available',
  version: 1,
  archivedAt: null,
  createdAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
};
const list: PrinterList = { items: [printer], page: 1, pageSize: 20, total: 1 };

describe('PrintersApi', () => {
  let api: PrintersApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(PrintersApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lists printers sending only the query parameters it was given', async () => {
    const result = firstValueFrom(api.list({ page: 2, pageSize: 20, status: 'in_use' }));

    const request = http.expectOne((r) => r.url === 'http://api.test/api/v1/printers');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('20');
    expect(request.request.params.get('status')).toBe('in_use');
    expect(request.request.params.has('sort')).toBe(false);
    request.flush({ ...list, page: 2 });

    await expect(result).resolves.toMatchObject({ page: 2, total: 1 });
  });

  it('gets one printer by id', async () => {
    const result = firstValueFrom(api.get(printer.id));

    http
      .expectOne({ method: 'GET', url: `http://api.test/api/v1/printers/${printer.id}` })
      .flush(printer);

    await expect(result).resolves.toEqual(printer);
  });

  describe('create', () => {
    const body = {
      name: 'Ender 3 Pro',
      buildVolume: printer.buildVolume,
      nozzle: printer.nozzle,
      compatibleMaterials: printer.compatibleMaterials,
    };

    it('creates a printer with a POST, the given body and no restore flag', async () => {
      const result = firstValueFrom(api.create(body));

      const request = http.expectOne({ method: 'POST', url: 'http://api.test/api/v1/printers' });
      expect(request.request.body).toEqual(body);
      expect('restoreIfDeleted' in (request.request.body as object)).toBe(false);
      request.flush(printer, { status: 201, statusText: 'Created' });

      await expect(result).resolves.toEqual({ printer, restored: false });
    });

    it('sends restoreIfDeleted true only when asked and reports a 200 as restored', async () => {
      const result = firstValueFrom(api.create(body, { restoreIfDeleted: true }));

      const request = http.expectOne({ method: 'POST', url: 'http://api.test/api/v1/printers' });
      expect(request.request.body).toEqual({ ...body, restoreIfDeleted: true });
      request.flush(printer, { status: 200, statusText: 'OK' });

      await expect(result).resolves.toEqual({ printer, restored: true });
    });

    it('rejects a created body that is not a printer', async () => {
      const result = firstValueFrom(api.create(body));

      http
        .expectOne('http://api.test/api/v1/printers')
        .flush({ nope: true }, { status: 201, statusText: 'Created' });

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });
  });

  describe('unarchive', () => {
    const url = `http://api.test/api/v1/printers/${printer.id}/unarchive`;

    it('posts an empty body and returns the printer', async () => {
      const result = firstValueFrom(api.unarchive(printer.id));

      const request = http.expectOne({ method: 'POST', url });
      expect(request.request.body).toEqual({});
      request.flush(printer);

      await expect(result).resolves.toEqual(printer);
    });

    it('rejects a response that is not a printer', async () => {
      const result = firstValueFrom(api.unarchive(printer.id));

      http.expectOne(url).flush({ ...printer, status: 'exploded' });

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });

    it('maps a 404 to an ApiError', async () => {
      const result = firstValueFrom(api.unarchive(printer.id));

      http
        .expectOne(url)
        .flush({ code: 'not_found', detail: 'x' }, { status: 404, statusText: 'Not Found' });

      const error: unknown = await result.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 404 });
    });
  });

  it('updates a printer with a PATCH that carries the version', async () => {
    const result = firstValueFrom(api.update(printer.id, { version: 3, name: 'Nueva' }));

    const request = http.expectOne({
      method: 'PATCH',
      url: `http://api.test/api/v1/printers/${printer.id}`,
    });
    expect(request.request.body).toEqual({ version: 3, name: 'Nueva' });
    request.flush({ ...printer, version: 4 });

    await expect(result).resolves.toMatchObject({ version: 4 });
  });

  it('removes a printer with a DELETE and completes on 204', async () => {
    const result = firstValueFrom(api.remove(printer.id));

    http
      .expectOne({ method: 'DELETE', url: `http://api.test/api/v1/printers/${printer.id}` })
      .flush(null, { status: 204, statusText: 'No Content' });

    await expect(result).resolves.toBeUndefined();
  });

  it('rejects a list response that does not match the contract', async () => {
    const result = firstValueFrom(api.list());

    http
      .expectOne((r) => r.url === 'http://api.test/api/v1/printers')
      .flush({ items: [{ ...printer, status: 'exploded' }], page: 1, pageSize: 20, total: 1 });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('rejects a printer whose materials are not in the catalog', () => {
    expect(isPrinter({ ...printer, compatibleMaterials: ['PLA', 'GOLD'] })).toBe(false);
    expect(isPrinter({ ...printer, nozzle: { diameterMm: 0.4, material: 'wood' } })).toBe(false);
    expect(isPrinter(null)).toBe(false);
    expect(isPrinter(printer)).toBe(true);
  });

  it('accepts a whole-number power or null and rejects anything else', () => {
    expect(isPrinter({ ...printer, powerWatts: 270 })).toBe(true);
    expect(isPrinter({ ...printer, powerWatts: null })).toBe(true);
    expect(isPrinter({ ...printer, powerWatts: 270.5 })).toBe(false);
    expect(isPrinter({ ...printer, powerWatts: '270' })).toBe(false);
    expect(isPrinter({ ...printer, powerWatts: undefined })).toBe(false);
  });

  it('maps a conflict to an ApiError that keeps the problem issues', async () => {
    const result = firstValueFrom(api.update(printer.id, { version: 1, name: 'x' }));

    http.expectOne(`http://api.test/api/v1/printers/${printer.id}`).flush(
      {
        code: 'conflict',
        detail: 'backend text',
        issues: [{ path: 'version', message: 'Does not match the current version.' }],
      },
      { status: 409, statusText: 'Conflict' },
    );

    const error: unknown = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'conflict',
      issues: [{ path: 'version', message: 'Does not match the current version.' }],
    });
  });

  it('fails with a network ApiError when the server cannot be reached', async () => {
    const result = firstValueFrom(api.list());

    http
      .expectOne((r) => r.url === 'http://api.test/api/v1/printers')
      .error(new ProgressEvent('error'));

    await expect(result).rejects.toMatchObject({ code: 'network_error' });
  });
});
