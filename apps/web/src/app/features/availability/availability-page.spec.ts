import { TestBed } from '@angular/core/testing';
import type { InterventionSchedule, UpdateScheduleRequest } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { AvailabilityApi } from './availability-api';
import { AvailabilityPage } from './availability-page';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

const workday = { ranges: [{ startMinute: 480, endMinute: 1080 }] };

function makeSchedule(overrides: Partial<InterventionSchedule> = {}): InterventionSchedule {
  return {
    weekly: [workday, workday, workday, workday, workday, workday, workday],
    exceptions: [],
    version: 3,
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

async function render() {
  const gets: Subject<InterventionSchedule>[] = [];
  const puts: Subject<InterventionSchedule>[] = [];
  const api = {
    getSchedule: vi.fn(() => {
      const reply = new Subject<InterventionSchedule>();
      gets.push(reply);
      return reply;
    }),
    putSchedule: vi.fn((_body: UpdateScheduleRequest) => {
      const reply = new Subject<InterventionSchedule>();
      puts.push(reply);
      return reply;
    }),
  };
  TestBed.configureTestingModule({
    imports: [AvailabilityPage],
    providers: [{ provide: AvailabilityApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(AvailabilityPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    gets,
    puts,
    text: () => element.textContent,
    input: (id: string) => element.querySelector<HTMLInputElement>(`#${id}`),
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label,
      ),
    live: () => element.querySelector('[aria-live="polite"]')?.textContent.trim() ?? '',
    async load(schedule: InterventionSchedule) {
      gets[gets.length - 1]?.next(schedule);
      await fixture.whenStable();
    },
    async type(id: string, value: string) {
      const input = view.input(id);
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      await fixture.whenStable();
    },
    async click(label: string) {
      view.button(label)?.click();
      await fixture.whenStable();
    },
    submit: () => view.click('Guardar'),
    async respond(schedule: InterventionSchedule) {
      puts[puts.length - 1]?.next(schedule);
      await fixture.whenStable();
    },
    async rejectSave(error: unknown) {
      puts[puts.length - 1]?.error(error);
      await fixture.whenStable();
    },
    sent: () => api.putSchedule.mock.lastCall?.[0],
  };
  return view;
}

describe('AvailabilityPage', () => {
  it('has one h1 and shows a loading message while waiting', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Disponibilidad para intervenir');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain('Cargando');
  });

  it('explains the idea and shows seven days with labelled HH:MM fields', async () => {
    const page = await render();

    await page.load(
      makeSchedule({
        weekly: [workday, workday, workday, workday, workday, workday, { ranges: [] }],
      }),
    );

    expect(page.text()).toContain('hora de Argentina');
    expect(page.text()).toContain('14 días');
    const legends = Array.from(page.element.querySelectorAll('legend')).map((l) => l.textContent);
    expect(legends.slice(0, 7)).toEqual([
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ]);
    expect(page.element.querySelector('label[for="w-0-0-start"]')?.textContent).toContain('Desde');
    expect(page.element.querySelector('label[for="w-0-0-end"]')?.textContent).toContain('Hasta');
    expect(page.input('w-0-0-start')?.value).toBe('08:00');
    expect(page.input('w-0-0-end')?.value).toBe('18:00');
    expect(page.input('w-6-0-start')).toBeNull();
    expect(page.text()).toContain('Sin rangos: no intervenís este día.');
    expect(page.text()).toContain('No hay excepciones cargadas.');
    expect(page.text()).not.toContain('Todavía no guardaste');
  });

  it('tells the user the defaults apply when the schedule was never saved', async () => {
    const page = await render();

    await page.load(makeSchedule({ version: 0, updatedAt: null }));

    expect(page.text()).toContain('Todavía no guardaste tu disponibilidad');
  });

  it('shows a safe message and retries the load when it fails', async () => {
    const page = await render();

    page.gets[0]?.error(problem(503));
    await page.fixture.whenStable();
    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'Mensaje seguro en español.',
    );
    expect(page.text()).not.toContain(SENTINEL);

    await page.click('Reintentar');
    expect(page.api.getSchedule).toHaveBeenCalledTimes(2);
  });

  it('saves the typed times as minutes with the loaded version', async () => {
    const page = await render();
    await page.load(makeSchedule({ version: 3 }));
    await page.type('w-0-0-start', '00:00');
    await page.type('w-0-0-end', '24:00');
    await page.type('w-1-0-start', '17:59');
    await page.type('w-1-0-end', '23:00');

    await page.submit();

    const body = page.sent();
    expect(body?.version).toBe(3);
    expect(body?.weekly).toHaveLength(7);
    expect(body?.weekly[0]?.ranges).toEqual([{ startMinute: 0, endMinute: 1440 }]);
    expect(body?.weekly[1]?.ranges).toEqual([{ startMinute: 1079, endMinute: 1380 }]);
    expect(body?.weekly[2]?.ranges).toEqual([{ startMinute: 480, endMinute: 1080 }]);
    expect(body?.exceptions).toEqual([]);
  });

  it('announces the save, and sends the new version on the next one', async () => {
    const page = await render();
    await page.load(makeSchedule({ version: 3 }));
    await page.submit();

    await page.respond(makeSchedule({ version: 4 }));

    expect(page.live()).toBe('Disponibilidad guardada.');
    await page.submit();
    expect(page.sent()?.version).toBe(4);
  });

  it('disables the button while saving and sends only one request', async () => {
    const page = await render();
    await page.load(makeSchedule());

    await page.submit();
    const button = page.element.querySelector<HTMLButtonElement>('button[type="submit"]');
    button?.click();
    await page.fixture.whenStable();

    expect(button?.disabled).toBe(true);
    expect(button?.textContent.trim()).toBe('Guardando…');
    expect(page.api.putSchedule).toHaveBeenCalledTimes(1);
  });

  describe('editing ranges', () => {
    it('adds a range, moves focus to it and announces it', async () => {
      const page = await render();
      await page.load(makeSchedule());

      await page.click('Agregar rango a Lunes');

      expect(page.input('w-0-1-start')).not.toBeNull();
      expect(document.activeElement).toBe(page.input('w-0-1-start'));
      expect(page.live()).toBe('Rango agregado a Lunes.');
    });

    it('removes a range and returns focus to the add button of that day', async () => {
      const page = await render();
      await page.load(makeSchedule());

      await page.click('Quitar rango 1 de Martes');

      expect(page.input('w-1-0-start')).toBeNull();
      expect(document.activeElement).toBe(page.element.querySelector('#w-1-add'));
      await page.submit();
      expect(page.sent()?.weekly[1]?.ranges).toEqual([]);
    });

    it('disables adding after six ranges in a day', async () => {
      const page = await render();
      await page.load(makeSchedule());

      for (let i = 0; i < 5; i++) await page.click('Agregar rango a Lunes');

      expect(page.element.querySelectorAll('[id^="w-0-"][id$="-start"]')).toHaveLength(6);
      expect(page.button('Agregar rango a Lunes')?.disabled).toBe(true);
    });

    it('copies the ranges of one day to every day', async () => {
      const page = await render();
      await page.load(makeSchedule());
      await page.type('w-2-0-start', '09:30');

      const copy = Array.from(page.element.querySelectorAll('button')).filter((b) =>
        b.textContent.includes('Copiar a todos los días'),
      )[2];
      copy?.click();
      await page.fixture.whenStable();
      expect(page.live()).toBe('Copiaste los rangos de Miércoles a todos los días.');
      await page.submit();

      expect(page.sent()?.weekly.every((d) => d.ranges[0]?.startMinute === 570)).toBe(true);
    });
  });

  describe('validation', () => {
    it.each([
      ['8', 'w-0-0-start', 'Escribí la hora con formato HH:MM'],
      ['25:00', 'w-0-0-start', 'Escribí la hora con formato HH:MM'],
      ['24:00', 'w-0-0-start', 'Escribí la hora con formato HH:MM'],
      ['abc', 'w-0-0-end', 'Escribí la hora con formato HH:MM'],
      ['08:00', 'w-0-0-end', 'posterior al «Desde»'],
      ['07:00', 'w-0-0-end', 'posterior al «Desde»'],
    ])('rejects %j in %s, focuses it and does not call the API', async (value, id, message) => {
      const page = await render();
      await page.load(makeSchedule());
      await page.type(id, value);

      await page.submit();

      expect(page.api.putSchedule).not.toHaveBeenCalled();
      const field = page.input(id);
      expect(field?.getAttribute('aria-invalid')).toBe('true');
      expect(field?.getAttribute('aria-describedby')).toBe(`${id}-error`);
      expect(page.element.querySelector(`#${id}-error`)?.textContent).toContain(message);
      expect(document.activeElement).toBe(field);
    });

    it('rejects overlapping ranges on the later one but allows touching ranges', async () => {
      const page = await render();
      await page.load(makeSchedule());
      await page.click('Agregar rango a Lunes');
      await page.type('w-0-1-start', '17:00');
      await page.type('w-0-1-end', '20:00');

      await page.submit();

      expect(page.api.putSchedule).not.toHaveBeenCalled();
      expect(page.element.querySelector('#w-0-1-start-error')?.textContent).toContain(
        'se superpone',
      );

      await page.type('w-0-1-start', '18:00');
      expect(page.element.querySelector('#w-0-1-start-error')).toBeNull();
      await page.submit();
      expect(page.sent()?.weekly[0]?.ranges).toEqual([
        { startMinute: 480, endMinute: 1080 },
        { startMinute: 1080, endMinute: 1200 },
      ]);
    });

    it('focuses the first invalid control in page order', async () => {
      const page = await render();
      await page.load(makeSchedule());
      await page.type('w-4-0-start', 'x');
      await page.type('w-1-0-end', 'x');

      await page.submit();

      expect(document.activeElement).toBe(page.input('w-1-0-end'));
    });
  });

  describe('exceptions', () => {
    it('adds an exception with no ranges meaning no intervention that day', async () => {
      const page = await render();
      await page.load(makeSchedule());

      await page.click('Agregar excepción');
      expect(document.activeElement).toBe(page.input('x-0-date'));
      expect(page.element.querySelector('label[for="x-0-date"]')?.textContent).toBe(
        'Fecha (DD-MM-AAAA)',
      );
      expect(page.text()).toContain('No intervengo ese día');
      await page.type('x-0-date', '25-12-2026');
      await page.submit();

      expect(page.sent()?.exceptions).toEqual([{ date: '2026-12-25', ranges: [] }]);
    });

    it('shows loaded exceptions as DD-MM-YYYY with their ranges', async () => {
      const page = await render();

      await page.load(
        makeSchedule({
          exceptions: [{ date: '2026-12-24', ranges: [{ startMinute: 540, endMinute: 780 }] }],
        }),
      );

      expect(page.input('x-0-date')?.value).toBe('24-12-2026');
      expect(page.input('x-0-0-start')?.value).toBe('09:00');
      expect(page.input('x-0-0-end')?.value).toBe('13:00');
    });

    it.each(['', '31-02-2026', '2026-12-25', '01-01-1999', '01-01-2100'])(
      'rejects %j as a date',
      async (value) => {
        const page = await render();
        await page.load(makeSchedule());
        await page.click('Agregar excepción');
        await page.type('x-0-date', value);

        await page.submit();

        expect(page.api.putSchedule).not.toHaveBeenCalled();
        expect(page.element.querySelector('#x-0-date-error')?.textContent).toContain('DD-MM-AAAA');
        expect(document.activeElement).toBe(page.input('x-0-date'));
      },
    );

    it('rejects a repeated date', async () => {
      const page = await render();
      await page.load(makeSchedule({ exceptions: [{ date: '2026-12-25', ranges: [] }] }));
      await page.click('Agregar excepción');
      await page.type('x-1-date', '25-12-2026');

      await page.submit();

      expect(page.api.putSchedule).not.toHaveBeenCalled();
      expect(page.element.querySelector('#x-1-date-error')?.textContent).toContain('repetida');
    });

    it('removes an exception and returns focus to the add button', async () => {
      const page = await render();
      await page.load(makeSchedule({ exceptions: [{ date: '2026-12-25', ranges: [] }] }));

      await page.click('Quitar Excepción 1');

      expect(page.input('x-0-date')).toBeNull();
      expect(document.activeElement).toBe(page.element.querySelector('#x-add'));
    });

    it('stops adding at 60 exceptions', async () => {
      const page = await render();
      const exceptions = Array.from({ length: 60 }, (_, i) => ({
        date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
        ranges: [],
      }));

      await page.load(makeSchedule({ exceptions }));

      expect(page.button('Agregar excepción')?.disabled).toBe(true);
    });
  });

  describe('save errors', () => {
    it('puts a 400 issue next to its range without showing backend text', async () => {
      const page = await render();
      await page.load(makeSchedule());
      await page.click('Agregar rango a Miércoles');
      await page.type('w-2-1-start', '19:00');
      await page.type('w-2-1-end', '21:00');
      await page.submit();

      await page.rejectSave(
        problem(400, [{ path: 'weekly.2.ranges.1.endMinute', message: SENTINEL }]),
      );

      expect(page.element.querySelector('#w-2-1-end-error')?.textContent).toContain(
        'Este horario no es válido',
      );
      expect(page.input('w-2-1-end')?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(page.input('w-2-1-end'));
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('maps an exception date issue to the date field', async () => {
      const page = await render();
      await page.load(makeSchedule({ exceptions: [{ date: '2026-12-25', ranges: [] }] }));
      await page.submit();

      await page.rejectSave(problem(400, [{ path: 'exceptions.0.date', message: SENTINEL }]));

      expect(page.element.querySelector('#x-0-date-error')?.textContent).toContain('fecha');
      expect(document.activeElement).toBe(page.input('x-0-date'));
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('offers to reload after a stale version and loads the new version', async () => {
      const page = await render();
      await page.load(makeSchedule({ version: 3 }));
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'version', message: SENTINEL }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Alguien modificó tu disponibilidad',
      );
      expect(page.text()).not.toContain(SENTINEL);

      await page.click('Recargar');
      expect(page.api.getSchedule).toHaveBeenCalledTimes(2);
      await page.load(
        makeSchedule({
          version: 5,
          weekly: [{ ranges: [] }, workday, workday, workday, workday, workday, workday],
        }),
      );
      expect(page.input('w-0-0-start')).toBeNull();
      expect(page.element.querySelector('[role="alert"]')).toBeNull();

      await page.submit();
      expect(page.sent()?.version).toBe(5);
    });

    it('shows the safe message for a 503 and keeps what was typed', async () => {
      const page = await render();
      await page.load(makeSchedule());
      await page.type('w-0-0-start', '07:15');
      await page.submit();

      await page.rejectSave(problem(503));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.input('w-0-0-start')?.value).toBe('07:15');
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('shows a generic message when the error is not an ApiError', async () => {
      const page = await render();
      await page.load(makeSchedule());
      await page.submit();

      await page.rejectSave(new Error(SENTINEL));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Ocurrió un error inesperado',
      );
      expect(page.text()).not.toContain(SENTINEL);
    });
  });
});
