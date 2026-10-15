import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Filament } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { FilamentConsumeDialog } from './filament-consume-dialog';
import { FilamentsApi } from './filaments-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

const filament: Filament = {
  id: 'f1',
  brand: 'Grilon3',
  material: 'PLA',
  colorName: 'Negro',
  initialGrams: 1000,
  availableGrams: 100,
  purchaseCostMinor: 1500000,
  purchaseDate: '2026-10-01',
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

const notEnough = () => problem(409, [{ path: 'grams', message: 'Not enough material.' }]);

@Component({
  imports: [FilamentConsumeDialog],
  template: `<app-filament-consume-dialog
    [filament]="filament"
    (consumed)="consumed.push($event)"
    (gone)="gone = gone + 1"
    (refresh)="refresh = refresh + 1"
    (cancelled)="cancelled = cancelled + 1"
  />`,
})
class Host {
  readonly filament = filament;
  readonly consumed: number[] = [];
  gone = 0;
  refresh = 0;
  cancelled = 0;
}

async function render() {
  const consumes: Subject<Filament>[] = [];
  const gets: Subject<Filament>[] = [];
  const api = {
    consume: vi.fn((_id: string, _grams: number) => {
      const reply = new Subject<Filament>();
      consumes.push(reply);
      return reply;
    }),
    get: vi.fn((_id: string) => {
      const reply = new Subject<Filament>();
      gets.push(reply);
      return reply;
    }),
  };
  TestBed.configureTestingModule({ providers: [{ provide: FilamentsApi, useValue: api }] });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const field = () => element.querySelector<HTMLInputElement>('#consume-grams');
  const button = (label: string) =>
    Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label);

  return {
    fixture,
    element,
    api,
    consumes,
    gets,
    host: fixture.componentInstance,
    field,
    button,
    errorText: () => element.querySelector('#consume-error')?.textContent.trim() ?? null,
    async submit(grams: string) {
      const input = field();
      if (input) input.value = grams;
      button('Descontar')?.click();
      await fixture.whenStable();
    },
    async rejectConsume(error: unknown) {
      consumes[consumes.length - 1]?.error(error);
      await fixture.whenStable();
    },
  };
}

describe('FilamentConsumeDialog', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });

  it('opens as a modal dialog with a labelled numeric grams field focused', async () => {
    const view = await render();

    const dialog = view.element.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(view.element.querySelector('h2')?.textContent).toBe('Descontar material');
    expect(dialog?.textContent).toContain('«Grilon3 · Negro»');
    const input = view.field();
    expect(input?.labels?.[0]?.textContent).toBe('Gramos a descontar');
    expect(input?.getAttribute('inputmode')).toBe('numeric');
    expect(input?.getAttribute('min')).toBe('1');
    expect(input?.getAttribute('max')).toBe('100');
    expect(document.activeElement).toBe(input);
  });

  describe('client validation', () => {
    it.each(['', '0', '-5', '1.5', '20001', 'abc', '1e3'])(
      'sends nothing and explains the problem for %j',
      async (value) => {
        const view = await render();

        await view.submit(value);

        expect(view.api.consume).not.toHaveBeenCalled();
        expect(view.errorText()).toBe('Ingresá un número entero de gramos, entre 1 y 20000.');
        expect(view.field()?.getAttribute('aria-invalid')).toBe('true');
        expect(view.field()?.getAttribute('aria-describedby')).toBe('consume-error');
        expect(view.element.querySelector('[role="alert"]')).not.toBeNull();
        expect(document.activeElement).toBe(view.field());
      },
    );

    it.each([['1'], ['20000']])('accepts the boundary %s', async (value) => {
      const view = await render();

      await view.submit(value);

      expect(view.api.consume).toHaveBeenCalledExactlyOnceWith('f1', Number(value));
    });

    it('does not use the available grams as a rule: the API decides', async () => {
      const view = await render();

      await view.submit('500');

      expect(view.api.consume).toHaveBeenCalledExactlyOnceWith('f1', 500);
    });

    it('clears the message as soon as the user types again', async () => {
      const view = await render();
      await view.submit('0');

      view.field()?.dispatchEvent(new Event('input'));
      await view.fixture.whenStable();

      expect(view.errorText()).toBeNull();
      expect(view.field()?.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('outcomes', () => {
    it('reports the grams taken when the API answers 200', async () => {
      const view = await render();
      await view.submit('30');

      view.consumes[0]?.next({ ...filament, availableGrams: 70 });
      await view.fixture.whenStable();

      expect(view.host.consumed).toEqual([30]);
      expect(view.host.gone).toBe(0);
    });

    it('stays open and says how many grams are left, from a fresh read, on a 409', async () => {
      const view = await render();
      await view.submit('500');

      await view.rejectConsume(notEnough());
      expect(view.api.get).toHaveBeenCalledExactlyOnceWith('f1');
      view.gets[0]?.next({ ...filament, availableGrams: 42 });
      await view.fixture.whenStable();

      expect(view.errorText()).toBe('No hay material suficiente: quedan 42 g.');
      expect(view.element.querySelector('dialog')?.hasAttribute('open')).toBe(true);
      expect(view.element.innerHTML).not.toContain(SENTINEL);
      expect(view.element.innerHTML).not.toContain('Not enough material');
      expect(view.host.consumed).toEqual([]);
      expect(view.host.refresh).toBe(1);
      expect(view.field()?.getAttribute('max')).toBe('42');
      expect(document.activeElement).toBe(view.field());
    });

    it('lets the user try a smaller amount after a 409', async () => {
      const view = await render();
      await view.submit('500');
      await view.rejectConsume(notEnough());
      view.gets[0]?.next({ ...filament, availableGrams: 42 });
      await view.fixture.whenStable();

      await view.submit('40');

      expect(view.api.consume).toHaveBeenCalledTimes(2);
      expect(view.api.consume).toHaveBeenLastCalledWith('f1', 40);
    });

    it('gives a generic message and asks for a refresh when the re-read fails', async () => {
      const view = await render();
      await view.submit('500');
      await view.rejectConsume(notEnough());

      view.gets[0]?.error(problem(500));
      await view.fixture.whenStable();

      expect(view.errorText()).toBe(
        'No hay material suficiente. Actualizá la lista e intentá de nuevo.',
      );
      expect(view.element.innerHTML).not.toContain(SENTINEL);
      expect(view.host.refresh).toBe(1);
      expect(view.element.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    });

    it('reports the filament as gone when the re-read answers 404', async () => {
      const view = await render();
      await view.submit('500');
      await view.rejectConsume(notEnough());

      view.gets[0]?.error(problem(404));
      await view.fixture.whenStable();

      expect(view.host.gone).toBe(1);
      expect(view.host.refresh).toBe(0);
    });

    it('does not read the filament again for a 409 that is not about the grams', async () => {
      const view = await render();
      await view.submit('30');

      await view.rejectConsume(problem(409, [{ path: 'other', message: 'x' }]));

      expect(view.api.get).not.toHaveBeenCalled();
      expect(view.errorText()).toBe('No se pudo descontar el material. Intentá de nuevo.');
    });

    it('reports the filament as gone on a 404, without a message', async () => {
      const view = await render();
      await view.submit('30');

      await view.rejectConsume(problem(404));

      expect(view.host.gone).toBe(1);
      expect(view.host.consumed).toEqual([]);
      expect(view.errorText()).toBeNull();
    });

    it.each([500, 503, 0])(
      'keeps the dialog, shows a generic Spanish error and asks for a refresh on a %i',
      async (status) => {
        const view = await render();
        await view.submit('30');

        await view.rejectConsume(problem(status));

        expect(view.errorText()).toBe('No se pudo descontar el material. Intentá de nuevo.');
        expect(view.element.innerHTML).not.toContain(SENTINEL);
        expect(view.host.refresh).toBe(1);
        expect(view.api.get).not.toHaveBeenCalled();
        expect(view.button('Descontar')?.disabled).toBe(false);
      },
    );

    it('treats a failure that is not an ApiError as a generic one', async () => {
      const view = await render();
      await view.submit('30');

      await view.rejectConsume(new Error(SENTINEL));

      expect(view.errorText()).toBe('No se pudo descontar el material. Intentá de nuevo.');
      expect(view.element.innerHTML).not.toContain(SENTINEL);
    });

    it('never sends the consume again by itself after a failure', async () => {
      const view = await render();
      await view.submit('30');

      await view.rejectConsume(problem(503));
      await view.fixture.whenStable();

      expect(view.api.consume).toHaveBeenCalledTimes(1);
    });
  });

  describe('while the request is in flight', () => {
    it('sends one request for a double click and disables both buttons', async () => {
      const view = await render();
      const input = view.field();
      if (input) input.value = '30';
      const confirm = view.button('Descontar');

      confirm?.click();
      confirm?.click();
      await view.fixture.whenStable();

      expect(view.api.consume).toHaveBeenCalledTimes(1);
      expect(view.button('Descontando…')?.disabled).toBe(true);
      expect(view.button('Cancelar')?.disabled).toBe(true);
    });

    it('ignores Escape', async () => {
      const view = await render();
      await view.submit('30');

      view.element
        .querySelector('dialog')
        ?.dispatchEvent(new Event('cancel', { cancelable: true }));

      expect(view.host.cancelled).toBe(0);
    });
  });

  describe('closing without consuming', () => {
    it('cancels with Cancelar and sends nothing', async () => {
      const view = await render();

      view.button('Cancelar')?.click();

      expect(view.host.cancelled).toBe(1);
      expect(view.api.consume).not.toHaveBeenCalled();
    });

    it('cancels on Escape and keeps the browser from closing the dialog itself', async () => {
      const view = await render();
      const escape = new Event('cancel', { cancelable: true });

      view.element.querySelector('dialog')?.dispatchEvent(escape);

      expect(escape.defaultPrevented).toBe(true);
      expect(view.host.cancelled).toBe(1);
    });
  });
});
