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
});
