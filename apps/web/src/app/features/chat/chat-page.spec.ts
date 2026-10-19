import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Project } from '@print3d/api-contracts';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ChatApi, type ChatReply, type Proposal } from './chat-api';
import { ChatPage } from './chat-page';

const UNAVAILABLE = 'El asistente no está disponible en este momento. Intentá de nuevo más tarde.';

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Expected element not found');
  return value;
}

function reply(text: string, proposal: Proposal | null = null): ChatReply {
  return { reply: text, proposal };
}

const HOSTILE = '<img src=x onerror="alert(1)">';
const PROPOSAL: Proposal = {
  kind: 'create_project',
  payload: {
    name: HOSTILE,
    description: 'Para la feria',
    priority: 'high',
    deadline: '2026-12-31',
    items: [
      { partId: 'p1', quantity: 3 },
      { partId: 'p2', quantity: 1 },
    ],
  },
  itemNames: [{ partId: 'p1', name: 'Soporte <b>x</b>' }],
};
const CREATED: Pick<Project, 'id' | 'name'> = { id: 'abc123', name: HOSTILE };

async function render(
  ask: (message: string) => Observable<ChatReply>,
  createProject: (payload: unknown) => Observable<Pick<Project, 'id' | 'name'>> = () => of(CREATED),
  createQueue: (payload: unknown) => Observable<{ projectId: string }> = () =>
    of({ projectId: 'proj1' }),
  updateQueueProgress: (
    projectId: string,
    body: unknown,
  ) => Observable<{ projectId: string }> = () => of({ projectId: 'proj1' }),
) {
  TestBed.configureTestingModule({
    imports: [ChatPage],
    providers: [
      provideRouter([]),
      {
        provide: ChatApi,
        useValue: { ask, createProject, createQueue, updateQueueProgress },
      },
    ],
  });
  const fixture = TestBed.createComponent(ChatPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const textarea = () => required(element.querySelector('textarea'));
  const buttons = () => Array.from(element.querySelectorAll('button'));
  const button = (name: string) => buttons().find((b) => b.textContent.trim() === name);
  return {
    fixture,
    element,
    textarea,
    button,
    log: () => required(element.querySelector('[role="log"]')),
    alert: () => element.querySelector('[role="alert"]'),
    async type(value: string) {
      textarea().value = value;
      textarea().dispatchEvent(new Event('input'));
      await fixture.whenStable();
    },
    async press(init: KeyboardEventInit) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      textarea().dispatchEvent(event);
      await fixture.whenStable();
      return event;
    },
    async click(name: string) {
      button(name)?.click();
      await fixture.whenStable();
    },
  };
}

describe('ChatPage', () => {
  it('has one h1 and disables sending while the message is empty', async () => {
    const page = await render(() => of(reply('x')));

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Asistente');
    expect(page.button('Enviar')?.disabled).toBe(true);
  });

  it('shows the user message and the reply in the conversation', async () => {
    const ask = vi.fn(() => of(reply('Tenés 3 proyectos.')));
    const page = await render(ask);

    await page.type('  ¿Cuántos proyectos hay?  ');
    await page.click('Enviar');

    expect(ask).toHaveBeenCalledWith('¿Cuántos proyectos hay?');
    expect(page.log().textContent).toContain('¿Cuántos proyectos hay?');
    expect(page.log().textContent).toContain('Tenés 3 proyectos.');
    expect(page.textarea().value).toBe('');
    expect(document.activeElement).toBe(page.textarea());
  });

  it('renders hostile text as plain text, never as markup', async () => {
    const hostile = '<img src=x onerror="alert(1)"><b>negrita</b>';
    const page = await render(() => of(reply(hostile)));

    await page.type('<script>alert(1)</script>');
    await page.click('Enviar');

    expect(page.log().querySelector('img, b, script')).toBeNull();
    expect(page.log().textContent).toContain(hostile);
    expect(page.log().textContent).toContain('<script>alert(1)</script>');
  });

  it('preserves line breaks with CSS instead of markup', async () => {
    const page = await render(() => of(reply('uno\ndos')));

    await page.type('hola');
    await page.click('Enviar');

    const answer = required(page.log().querySelector('.message:not(.message--user) .text'));
    expect(answer.textContent).toBe('uno\ndos');
    expect(getComputedStyle(answer).whiteSpace).toBe('pre-wrap');
  });

  it('counts characters and blocks a message over 2000 characters', async () => {
    const page = await render(() => of(reply('x')));

    await page.type('a'.repeat(2000));
    expect(page.element.textContent).toContain('2000 / 2000');
    expect(page.button('Enviar')?.disabled).toBe(false);

    await page.type('a'.repeat(2001));
    expect(page.button('Enviar')?.disabled).toBe(true);
  });

  it('shows a thinking status and prevents double submission', async () => {
    const pending = new Subject<ChatReply>();
    const ask = vi.fn(() => pending);
    const page = await render(ask);

    await page.type('uno');
    await page.click('Enviar');
    await page.type('dos');
    await page.press({ key: 'Enter' });
    await page.click('Enviar');

    expect(page.element.querySelector('[role="status"]')?.textContent).toContain('Pensando…');
    expect(page.button('Enviar')?.disabled).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);

    pending.next(reply('listo'));
    await page.fixture.whenStable();

    expect(page.element.querySelector('[role="status"]')).toBeNull();
  });

  it('sends with Enter and keeps a newline with Shift+Enter', async () => {
    const ask = vi.fn(() => of(reply('ok')));
    const page = await render(ask);

    await page.type('hola');
    const shifted = await page.press({ key: 'Enter', shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(ask).not.toHaveBeenCalled();

    const plain = await page.press({ key: 'Enter' });
    expect(plain.defaultPrevented).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('shows a fixed message and focuses Reintentar when the assistant is unavailable', async () => {
    const sentinel = 'SENTINEL traceback at /srv/secret.py';
    const page = await render(() =>
      throwError(() => new ApiError(503, 'service_unavailable', sentinel, [], null, { sentinel })),
    );

    await page.type('hola');
    await page.click('Enviar');

    expect(page.alert()?.textContent).toContain(UNAVAILABLE);
    expect(page.element.textContent).not.toContain('SENTINEL');
    expect(document.activeElement).toBe(page.button('Reintentar'));
  });

  it('shows a fixed validation text on a 400 without backend text', async () => {
    const page = await render(() =>
      throwError(() => new ApiError(400, 'validation_error', 'SENTINEL detail')),
    );

    await page.type('hola');
    await page.click('Enviar');

    expect(page.alert()?.textContent).toContain('El mensaje no es válido');
    expect(page.element.textContent).not.toContain('SENTINEL');
  });

  it('resends the last message from Reintentar without duplicating it', async () => {
    let calls = 0;
    const ask = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? throwError(() => new ApiError(503, 'service_unavailable', 'x'))
        : of(reply('ahora sí'));
    });
    const page = await render(ask);

    await page.type('hola');
    await page.click('Enviar');
    await page.click('Reintentar');

    expect(ask).toHaveBeenNthCalledWith(2, 'hola');
    expect(page.alert()).toBeNull();
    expect(page.log().textContent).toContain('ahora sí');
    expect(page.log().querySelectorAll('.message--user')).toHaveLength(1);
  });

  it('clears the conversation, including a failed attempt', async () => {
    const page = await render(() =>
      throwError(() => new ApiError(503, 'service_unavailable', 'x')),
    );

    await page.type('hola');
    await page.click('Enviar');
    await page.click('Limpiar conversación');

    expect(page.log().querySelectorAll('.message')).toHaveLength(0);
    expect(page.alert()).toBeNull();
  });

  it('cancels the request in flight when the page is destroyed', async () => {
    let unsubscribed = false;
    const page = await render(
      () =>
        new Observable<ChatReply>(() => () => {
          unsubscribed = true;
        }),
    );

    await page.type('hola');
    await page.click('Enviar');
    page.fixture.destroy();

    expect(unsubscribed).toBe(true);
  });

  describe('assistant proposal card', () => {
    type Created = Pick<Project, 'id' | 'name'>;
    async function withCard(createProject?: (payload: unknown) => Observable<Created>) {
      const page = await render(() => of(reply('Te armé una propuesta.', PROPOSAL)), createProject);
      await page.type('creá un proyecto');
      await page.click('Enviar');
      return page;
    }
    const card = (page: { element: HTMLElement }) =>
      page.element.querySelector('[role="group"][aria-label="Propuesta del asistente"]');

    it('renders the Spanish description built from the payload, hostile text as text', async () => {
      const page = await withCard();
      const text = card(page)?.textContent ?? '';

      expect(text).toContain(`Crear el proyecto «${HOSTILE}»`);
      expect(text).toContain('Para la feria');
      expect(text).toContain('Alta');
      expect(text).toContain('31-12-2026');
      expect(text).toContain('3 × Soporte <b>x</b>');
      expect(text).toContain('1 × Pieza');
      expect(text).toContain('Todavía no se creó nada.');
      expect(card(page)?.querySelector('img, b')).toBeNull();
      expect(page.button('Confirmar')).toBeDefined();
      expect(page.button('Descartar')).toBeDefined();
    });

    it('sends the exact payload on Confirmar, then shows the link and focuses it', async () => {
      const createProject = vi.fn((_payload: unknown) => of(CREATED));
      const page = await withCard(createProject);

      await page.click('Confirmar');

      expect(createProject).toHaveBeenCalledExactlyOnceWith(PROPOSAL.payload);
      expect(card(page)?.textContent).toContain(`Proyecto creado: «${HOSTILE}»`);
      expect(card(page)?.textContent).not.toContain('Todavía no se creó nada.');
      const link = required(card(page)?.querySelector('a') ?? null);
      expect(link.getAttribute('href')).toBe('/proyectos/abc123/editar');
      expect(document.activeElement).toBe(link);
      expect(page.button('Confirmar')).toBeUndefined();
      expect(page.button('Descartar')).toBeUndefined();
    });

    it('sends only one request when Confirmar is clicked twice', async () => {
      const pending = new Subject<Created>();
      const createProject = vi.fn((_payload: unknown) => pending);
      const page = await withCard(createProject);

      page.button('Confirmar')?.click();
      page.button('Confirmar')?.click();
      await page.fixture.whenStable();

      expect(createProject).toHaveBeenCalledTimes(1);
      expect(page.button('Confirmar')?.disabled).toBe(true);
    });

    it('shows a fixed message on 400 and retries with the same payload', async () => {
      let calls = 0;
      const createProject = vi.fn((_payload: unknown) => {
        calls += 1;
        return calls === 1
          ? throwError(() => new ApiError(400, 'validation_error', 'SENTINEL detail'))
          : of(CREATED);
      });
      const page = await withCard(createProject);

      await page.click('Confirmar');
      expect(card(page)?.textContent).toContain(
        'La API no aceptó la propuesta; revisá los datos en Proyectos.',
      );
      expect(page.element.textContent).not.toContain('SENTINEL');

      await page.click('Reintentar');
      expect(createProject).toHaveBeenCalledTimes(2);
      expect(createProject).toHaveBeenNthCalledWith(2, PROPOSAL.payload);
      expect(card(page)?.textContent).toContain('Proyecto creado');
    });

    it('shows a generic fixed message on 409 without backend text', async () => {
      const page = await withCard(() =>
        throwError(() => new ApiError(409, 'conflict', 'SENTINEL conflict')),
      );

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain(
        'No pudimos confirmar si se creó el proyecto. Revisá Proyectos antes de reintentar.',
      );
      expect(card(page)?.querySelector('a')?.getAttribute('href')).toBe('/proyectos');
      expect(page.button('Reintentar')).toBeDefined();
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('warns it may exist after a network failure (status 0)', async () => {
      const page = await withCard(() =>
        throwError(() => new ApiError(0, 'network_error', 'SENTINEL net')),
      );

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain('No pudimos confirmar si se creó');
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('shows no Proyectos link after a certain 400 rejection', async () => {
      const page = await withCard(() =>
        throwError(() => new ApiError(400, 'validation_error', 'x')),
      );

      await page.click('Confirmar');

      expect(card(page)?.querySelector('a')).toBeNull();
    });

    it('disables Limpiar conversación while a confirmation is in flight', async () => {
      const pending = new Subject<Created>();
      const page = await withCard(() => pending);

      await page.click('Confirmar');

      const clear = required(page.button('Limpiar conversación') ?? null);
      expect(clear.disabled).toBe(true);
      expect(clear.getAttribute('aria-describedby')).toBe('clear-hint');
      expect(page.element.querySelector('#clear-hint')?.textContent).toContain('Esperá');

      pending.next(CREATED);
      await page.fixture.whenStable();
      expect(page.button('Limpiar conversación')?.disabled).toBe(false);
    });

    it('discards the card, removes the buttons and focuses the textarea', async () => {
      const createProject = vi.fn((_payload: unknown) => of(CREATED));
      const page = await withCard(createProject);

      await page.click('Descartar');

      expect(card(page)?.textContent).toContain('Descartada');
      expect(page.button('Confirmar')).toBeUndefined();
      expect(page.button('Descartar')).toBeUndefined();
      expect(document.activeElement).toBe(page.textarea());
      expect(createProject).not.toHaveBeenCalled();
    });

    it('removes the cards when the conversation is cleared', async () => {
      const page = await withCard();

      await page.click('Limpiar conversación');

      expect(card(page)).toBeNull();
    });
  });

  describe('assistant queue proposal card', () => {
    const QUEUE: Proposal = {
      kind: 'create_queue',
      payload: { projectId: 'proj1', goal: 'minimal_idle', mode: 'multi', printerIds: ['a', 'b'] },
      projectName: HOSTILE,
      printerNames: [{ printerId: 'a', name: 'Ender <b>3</b>' }],
    };
    type QueueCall = (payload: unknown) => Observable<{ projectId: string }>;
    async function withQueueCard(createQueue?: QueueCall) {
      const page = await render(() => of(reply('Armé una cola.', QUEUE)), undefined, createQueue);
      await page.type('creá la cola');
      await page.click('Enviar');
      return page;
    }
    const card = (page: { element: HTMLElement }) =>
      page.element.querySelector('[role="group"][aria-label="Propuesta del asistente"]');

    it('renders the Spanish description from the payload, hostile text as text', async () => {
      const page = await withQueueCard();
      const text = card(page)?.textContent ?? '';

      expect(text).toContain(`Crear la cola de impresión del proyecto «${HOSTILE}»`);
      expect(text).toContain('Objetivo: Minimizar tiempos muertos');
      expect(text).toContain('Modo: Varias impresoras');
      expect(text).toContain('Ender <b>3</b>');
      expect(text).toContain('Impresora');
      expect(text).toContain('Las líneas se toman de las piezas del proyecto.');
      expect(text).toContain('Todavía no se creó nada.');
      expect(card(page)?.querySelector('img, b')).toBeNull();
    });

    it('sends the exact body once and shows Cola creada with a link', async () => {
      const createQueue = vi.fn((_payload: unknown) => of({ projectId: 'proj1' }));
      const page = await withQueueCard(createQueue);

      page.button('Confirmar')?.click();
      page.button('Confirmar')?.click();
      await page.fixture.whenStable();

      expect(createQueue).toHaveBeenCalledExactlyOnceWith(QUEUE.payload);
      expect(card(page)?.textContent).toContain('Cola creada');
      expect(card(page)?.querySelector('a')?.getAttribute('href')).toBe('/proyectos/proj1/cola');
      expect(page.button('Confirmar')).toBeUndefined();
    });

    it('says the project already has a queue on 409, with no retry', async () => {
      const page = await withQueueCard(() =>
        throwError(() => new ApiError(409, 'conflict', 'SENTINEL dup')),
      );

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain('Ese proyecto ya tiene una cola.');
      expect(card(page)?.querySelector('a')?.getAttribute('href')).toBe('/proyectos/proj1/cola');
      expect(page.button('Reintentar')).toBeUndefined();
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('shows a fixed message on 400', async () => {
      const page = await withQueueCard(() =>
        throwError(() => new ApiError(400, 'validation_error', 'SENTINEL bad')),
      );

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain('La API no aceptó la propuesta; revisá los datos.');
      expect(page.button('Reintentar')).toBeDefined();
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('warns it may exist on an uncertain failure', async () => {
      const page = await withQueueCard(() =>
        throwError(() => new ApiError(503, 'service_unavailable', 'SENTINEL down')),
      );

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain('No pudimos confirmar si se creó');
      expect(card(page)?.querySelector('a')?.getAttribute('href')).toBe('/proyectos');
      expect(page.button('Reintentar')).toBeDefined();
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('discards without sending anything', async () => {
      const createQueue = vi.fn((_payload: unknown) => of({ projectId: 'proj1' }));
      const page = await withQueueCard(createQueue);

      await page.click('Descartar');

      expect(card(page)?.textContent).toContain('Descartada');
      expect(page.button('Confirmar')).toBeUndefined();
      expect(createQueue).not.toHaveBeenCalled();
    });

    it('disables Limpiar conversación while the queue is being created', async () => {
      const page = await withQueueCard(() => new Subject<{ projectId: string }>());

      await page.click('Confirmar');

      expect(page.button('Limpiar conversación')?.disabled).toBe(true);
    });
  });

  describe('assistant progress proposal card', () => {
    const LINES = [
      { partId: 'a', quantity: 5, completed: 2 },
      { partId: 'b', quantity: 3, completed: 3 },
    ];
    const PROGRESS: Proposal = {
      kind: 'update_queue_progress',
      payload: { projectId: 'proj1', version: 4, lines: LINES },
      projectName: HOSTILE,
      lineNames: [{ partId: 'a', name: 'Base <b>x</b>' }],
    };
    type Patch = (projectId: string, body: unknown) => Observable<{ projectId: string }>;
    async function withProgressCard(update?: Patch) {
      const page = await render(
        () => of(reply('Armé el avance.', PROGRESS)),
        undefined,
        undefined,
        update,
      );
      await page.type('marcá el avance');
      await page.click('Enviar');
      return page;
    }
    const card = (page: { element: HTMLElement }) =>
      page.element.querySelector('[role="group"][aria-label="Propuesta del asistente"]');
    const fail = (status: number) => () =>
      throwError(() => new ApiError(status, 'x', 'SENTINEL backend text'));

    it('renders the Spanish description from the payload, hostile text as text', async () => {
      const page = await withProgressCard();
      const text = card(page)?.textContent ?? '';

      expect(text).toContain(`Actualizar el avance de la cola del proyecto «${HOSTILE}»`);
      expect(text).toContain('Base <b>x</b>: 2 de 5 impresas');
      expect(text).toContain('Pieza: 3 de 3 impresas');
      expect(text).toContain('Todavía no se cambió nada.');
      expect(card(page)?.querySelector('img, b')).toBeNull();
    });

    it('sends the exact PATCH once and shows the link, focused', async () => {
      const update = vi.fn((_id: string, _body: unknown) => of({ projectId: 'proj1' }));
      const page = await withProgressCard(update);

      page.button('Confirmar')?.click();
      page.button('Confirmar')?.click();
      await page.fixture.whenStable();

      expect(update).toHaveBeenCalledExactlyOnceWith('proj1', {
        version: 4,
        lines: LINES,
      });
      expect(card(page)?.textContent).toContain('Avance actualizado.');
      const link = required(card(page)?.querySelector('a') ?? null);
      expect(link.textContent).toBe('Abrir la cola');
      expect(link.getAttribute('href')).toBe('/proyectos/proj1/cola');
      expect(document.activeElement).toBe(link);
      expect(page.button('Confirmar')).toBeUndefined();
    });

    it('on 409 says the queue changed, links to it and offers no retry', async () => {
      const page = await withProgressCard(fail(409));

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain(
        'La cola cambió desde que se hizo la propuesta. Pedila de nuevo.',
      );
      expect(card(page)?.querySelector('a')?.getAttribute('href')).toBe('/proyectos/proj1/cola');
      expect(page.button('Reintentar')).toBeUndefined();
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('on 404 says there is no queue, links to Proyectos and offers no retry', async () => {
      const page = await withProgressCard(fail(404));

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain('Ese proyecto ya no tiene cola.');
      expect(card(page)?.querySelector('a')?.getAttribute('href')).toBe('/proyectos');
      expect(page.button('Reintentar')).toBeUndefined();
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('on 400 shows a fixed message and retries with the same body', async () => {
      let calls = 0;
      const update = vi.fn((_id: string, _body: unknown) => {
        calls += 1;
        return calls === 1 ? fail(400)() : of({ projectId: 'proj1' });
      });
      const page = await withProgressCard(update);

      await page.click('Confirmar');
      expect(card(page)?.textContent).toContain('La API no aceptó la propuesta; revisá los datos.');
      expect(page.element.textContent).not.toContain('SENTINEL');

      await page.click('Reintentar');
      expect(update).toHaveBeenCalledTimes(2);
      expect(update.mock.calls[1]).toEqual(update.mock.calls[0]);
      expect(card(page)?.textContent).toContain('Avance actualizado.');
    });

    it('on an uncertain failure warns, links to Proyectos and allows retry', async () => {
      const page = await withProgressCard(fail(503));

      await page.click('Confirmar');

      expect(card(page)?.textContent).toContain('No pudimos confirmar si se actualizó el avance.');
      expect(card(page)?.querySelector('a')?.getAttribute('href')).toBe('/proyectos');
      expect(page.button('Reintentar')).toBeDefined();
      expect(page.element.textContent).not.toContain('SENTINEL');
    });

    it('discards without sending anything', async () => {
      const update = vi.fn((_id: string, _body: unknown) => of({ projectId: 'proj1' }));
      const page = await withProgressCard(update);

      await page.click('Descartar');

      expect(card(page)?.textContent).toContain('Descartada');
      expect(page.button('Confirmar')).toBeUndefined();
      expect(update).not.toHaveBeenCalled();
    });

    it('disables Limpiar conversación while the update is in flight', async () => {
      const page = await withProgressCard(() => new Subject<{ projectId: string }>());

      await page.click('Confirmar');

      expect(page.button('Limpiar conversación')?.disabled).toBe(true);
    });
  });
});
