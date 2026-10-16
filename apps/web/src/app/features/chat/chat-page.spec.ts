import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ChatApi } from './chat-api';
import { ChatPage } from './chat-page';

const UNAVAILABLE = 'El asistente no está disponible en este momento. Intentá de nuevo más tarde.';

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Expected element not found');
  return value;
}

async function render(ask: (message: string) => Observable<string>) {
  TestBed.configureTestingModule({
    imports: [ChatPage],
    providers: [{ provide: ChatApi, useValue: { ask } }],
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
    const page = await render(() => of('x'));

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Asistente');
    expect(page.button('Enviar')?.disabled).toBe(true);
  });

  it('shows the user message and the reply in the conversation', async () => {
    const ask = vi.fn(() => of('Tenés 3 proyectos.'));
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
    const page = await render(() => of(hostile));

    await page.type('<script>alert(1)</script>');
    await page.click('Enviar');

    expect(page.log().querySelector('img, b, script')).toBeNull();
    expect(page.log().textContent).toContain(hostile);
    expect(page.log().textContent).toContain('<script>alert(1)</script>');
  });

  it('preserves line breaks with CSS instead of markup', async () => {
    const page = await render(() => of('uno\ndos'));

    await page.type('hola');
    await page.click('Enviar');

    const reply = required(page.log().querySelector('.message:not(.message--user) .text'));
    expect(reply.textContent).toBe('uno\ndos');
    expect(getComputedStyle(reply).whiteSpace).toBe('pre-wrap');
  });

  it('counts characters and blocks a message over 2000 characters', async () => {
    const page = await render(() => of('x'));

    await page.type('a'.repeat(2000));
    expect(page.element.textContent).toContain('2000 / 2000');
    expect(page.button('Enviar')?.disabled).toBe(false);

    await page.type('a'.repeat(2001));
    expect(page.button('Enviar')?.disabled).toBe(true);
  });

  it('shows a thinking status and prevents double submission', async () => {
    const pending = new Subject<string>();
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

    pending.next('listo');
    await page.fixture.whenStable();

    expect(page.element.querySelector('[role="status"]')).toBeNull();
  });

  it('sends with Enter and keeps a newline with Shift+Enter', async () => {
    const ask = vi.fn(() => of('ok'));
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
        : of('ahora sí');
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
        new Observable<string>(() => () => {
          unsubscribed = true;
        }),
    );

    await page.type('hola');
    await page.click('Enviar');
    page.fixture.destroy();

    expect(unsubscribed).toBe(true);
  });
});
