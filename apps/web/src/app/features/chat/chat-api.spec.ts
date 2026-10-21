import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { ApiError } from '../../core/api/api-error';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { ChatApi } from './chat-api';

describe('ChatApi', () => {
  let api: ChatApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(ChatApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('posts the message and emits the reply', async () => {
    const result = firstValueFrom(api.ask('Hola'));

    const request = http.expectOne({ method: 'POST', url: 'http://api.test/api/v1/chat' });
    expect(request.request.body).toEqual({ message: 'Hola' });
    request.flush({ reply: 'Buenas' });

    await expect(result).resolves.toEqual({ reply: 'Buenas', proposal: null });
  });

  const proposal = {
    kind: 'create_project',
    payload: { name: 'A', items: [{ partId: 'p1', quantity: 2 }] },
    itemNames: [{ partId: 'p1', name: 'Pieza uno' }],
  };

  it('passes a well-formed proposal through', async () => {
    const result = firstValueFrom(api.ask('Hola'));

    http.expectOne('http://api.test/api/v1/chat').flush({ reply: 'ok', proposal });

    await expect(result).resolves.toEqual({ reply: 'ok', proposal });
  });

  it.each([
    ['wrong kind', { ...proposal, kind: 'delete_project' }],
    ['missing name', { ...proposal, payload: { items: [] } }],
    ['bad priority', { ...proposal, payload: { name: 'A', priority: 'x' } }],
    ['bad deadline', { ...proposal, payload: { name: 'A', deadline: 'mañana' } }],
    ['bad item', { ...proposal, payload: { name: 'A', items: [{ partId: 1 }] } }],
    ['no itemNames', { kind: 'create_project', payload: { name: 'A' } }],
  ])('keeps the reply and drops a malformed proposal (%s)', async (_label, bad) => {
    const result = firstValueFrom(api.ask('Hola'));

    http.expectOne('http://api.test/api/v1/chat').flush({ reply: 'ok', proposal: bad });

    await expect(result).resolves.toEqual({ reply: 'ok', proposal: null });
  });

  const queueProposal = {
    kind: 'create_queue',
    payload: { projectId: 'p', goal: 'fastest', mode: 'single', printerIds: ['a'] },
    projectName: 'Proy',
    printerNames: [{ printerId: 'a', name: 'Ender' }],
  };

  it('passes a well-formed queue proposal through', async () => {
    const result = firstValueFrom(api.ask('Hola'));

    http.expectOne('http://api.test/api/v1/chat').flush({ reply: 'ok', proposal: queueProposal });

    await expect(result).resolves.toEqual({ reply: 'ok', proposal: queueProposal });
  });

  it.each([
    ['bad goal', { ...queueProposal, payload: { ...queueProposal.payload, goal: 'x' } }],
    ['bad mode', { ...queueProposal, payload: { ...queueProposal.payload, mode: 'x' } }],
    [
      'non-string printer id',
      {
        ...queueProposal,
        payload: { projectId: 'p', goal: 'fastest', mode: 'single', printerIds: [1] },
      },
    ],
    ['no projectName', { ...queueProposal, projectName: undefined }],
    ['bad printerNames', { ...queueProposal, printerNames: [{ name: 'x' }] }],
  ])('drops a malformed queue proposal keeping the reply (%s)', async (_label, bad) => {
    const result = firstValueFrom(api.ask('Hola'));

    http.expectOne('http://api.test/api/v1/chat').flush({ reply: 'ok', proposal: bad });

    await expect(result).resolves.toEqual({ reply: 'ok', proposal: null });
  });

  it('posts the queue payload to /queues and rejects an unexpected response', async () => {
    const ok = firstValueFrom(
      api.createQueue({ projectId: 'p', goal: 'fastest', mode: 'single', printerIds: ['a'] }),
    );
    const request = http.expectOne({ method: 'POST', url: 'http://api.test/api/v1/queues' });
    expect(request.request.body).toEqual({
      projectId: 'p',
      goal: 'fastest',
      mode: 'single',
      printerIds: ['a'],
    });
    request.flush({ projectId: 'p', goal: 'fastest' });
    await expect(ok).resolves.toMatchObject({ projectId: 'p' });

    const bad = firstValueFrom(
      api.createQueue({ projectId: 'p', goal: 'fastest', mode: 'single', printerIds: ['a'] }),
    );
    http.expectOne('http://api.test/api/v1/queues').flush({ nope: 1 });
    await expect(bad).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  const progressProposal = {
    kind: 'update_queue_progress',
    payload: { projectId: 'p', version: 3, lines: [{ partId: 'a', quantity: 5, completed: 2 }] },
    projectName: 'Proy',
    lineNames: [{ partId: 'a', name: 'Pieza' }],
  };

  it('passes a well-formed progress proposal through', async () => {
    const result = firstValueFrom(api.ask('Hola'));

    http
      .expectOne('http://api.test/api/v1/chat')
      .flush({ reply: 'ok', proposal: progressProposal });

    await expect(result).resolves.toEqual({ reply: 'ok', proposal: progressProposal });
  });

  it.each([
    ['no version', { ...progressProposal, payload: { projectId: 'p', lines: [] } }],
    [
      'bad line',
      { ...progressProposal, payload: { projectId: 'p', version: 1, lines: [{ partId: 'a' }] } },
    ],
    ['no projectName', { ...progressProposal, projectName: undefined }],
    ['bad lineNames', { ...progressProposal, lineNames: [{ name: 'x' }] }],
  ])('drops a malformed progress proposal keeping the reply (%s)', async (_label, bad) => {
    const result = firstValueFrom(api.ask('Hola'));

    http.expectOne('http://api.test/api/v1/chat').flush({ reply: 'ok', proposal: bad });

    await expect(result).resolves.toEqual({ reply: 'ok', proposal: null });
  });

  it('patches the progress to the encoded queue URL and rejects an unexpected response', async () => {
    const body = { version: 3, lines: [{ partId: 'a', quantity: 5, completed: 2 }] };
    const ok = firstValueFrom(api.updateQueueProgress('a/b?', body));
    const request = http.expectOne({
      method: 'PATCH',
      url: 'http://api.test/api/v1/queues/a%2Fb%3F',
    });
    expect(request.request.body).toEqual(body);
    request.flush({ projectId: 'a/b?', goal: 'fastest' });
    await expect(ok).resolves.toMatchObject({ projectId: 'a/b?' });

    const bad = firstValueFrom(api.updateQueueProgress('p', body));
    http.expectOne('http://api.test/api/v1/queues/p').flush({ nope: 1 });
    await expect(bad).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('does not retry a failed progress update', async () => {
    const result = firstValueFrom(api.updateQueueProgress('p', { version: 1, lines: [] }));

    http
      .expectOne('http://api.test/api/v1/queues/p')
      .flush({ code: 'conflict' }, { status: 409, statusText: 'Conflict' });

    await expect(result).rejects.toMatchObject({ status: 409 });
  });

  it('posts the payload to /projects and emits the created project', async () => {
    const result = firstValueFrom(api.createProject({ name: 'A' }));

    const request = http.expectOne({ method: 'POST', url: 'http://api.test/api/v1/projects' });
    expect(request.request.body).toEqual({ name: 'A' });
    request.flush({ id: 'x1', name: 'A' });

    await expect(result).resolves.toMatchObject({ id: 'x1' });
  });

  it('rejects a created project that does not match the contract', async () => {
    const result = firstValueFrom(api.createProject({ name: 'A' }));

    http.expectOne('http://api.test/api/v1/projects').flush({ nope: 1 });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('rejects a 200 response that does not match the contract', async () => {
    const result = firstValueFrom(api.ask('Hola'));

    http.expectOne('http://api.test/api/v1/chat').flush({ answer: 'x' });

    await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('fails with an ApiError carrying the status on a 503', async () => {
    const result = firstValueFrom(api.ask('Hola'));

    http
      .expectOne('http://api.test/api/v1/chat')
      .flush({ code: 'service_unavailable' }, { status: 503, statusText: 'Unavailable' });

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status: 503 });
  });

  describe('G-code import', () => {
    const importProposal = {
      kind: 'import_gcodes',
      payload: { material: 'PLA', folder: 'Minis' },
    };

    it.each([
      ['with a folder', importProposal],
      ['without a folder', { kind: 'import_gcodes', payload: { material: 'PETG' } }],
    ])('passes a well-formed import proposal through (%s)', async (_label, proposal) => {
      const result = firstValueFrom(api.ask('Hola'));

      http.expectOne('http://api.test/api/v1/chat').flush({ reply: 'ok', proposal });

      await expect(result).resolves.toEqual({ reply: 'ok', proposal });
    });

    it.each([
      ['no payload', { kind: 'import_gcodes' }],
      ['no material', { kind: 'import_gcodes', payload: { folder: 'Minis' } }],
      ['a numeric material', { kind: 'import_gcodes', payload: { material: 7 } }],
      ['a numeric folder', { kind: 'import_gcodes', payload: { material: 'PLA', folder: 3 } }],
    ])('drops a malformed import proposal keeping the reply (%s)', async (_label, bad) => {
      const result = firstValueFrom(api.ask('Hola'));

      http.expectOne('http://api.test/api/v1/chat').flush({ reply: 'ok', proposal: bad });

      await expect(result).resolves.toEqual({ reply: 'ok', proposal: null });
    });

    it('posts the payload to /gcode-imports and emits the counts', async () => {
      const counts = { created: 2, updated: 1, unchanged: 3, skipped: 0, errors: 0 };
      const result = firstValueFrom(api.importGcodes({ material: 'PLA', folder: 'Minis' }));

      const request = http.expectOne({
        method: 'POST',
        url: 'http://api.test/api/v1/gcode-imports',
      });
      expect(request.request.body).toEqual({ material: 'PLA', folder: 'Minis' });
      request.flush(counts);

      await expect(result).resolves.toEqual(counts);
    });

    it.each([
      ['an unexpected body', { nope: 1 }],
      ['a fractional count', { created: 1.5, updated: 0, unchanged: 0, skipped: 0, errors: 0 }],
      ['a missing count', { created: 1, updated: 0, unchanged: 0, skipped: 0 }],
    ])('rejects %s', async (_label, body) => {
      const result = firstValueFrom(api.importGcodes({ material: 'PLA' }));

      http.expectOne('http://api.test/api/v1/gcode-imports').flush(body);

      await expect(result).rejects.toMatchObject({ code: 'unexpected_response' });
    });

    it('does not retry a failed import', async () => {
      const result = firstValueFrom(api.importGcodes({ material: 'PLA' }));

      http
        .expectOne('http://api.test/api/v1/gcode-imports')
        .flush({ code: 'service_unavailable' }, { status: 503, statusText: 'Unavailable' });

      await expect(result).rejects.toMatchObject({ status: 503 });
    });
  });
});
