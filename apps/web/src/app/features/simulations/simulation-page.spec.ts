import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { Optimization, Simulation, SimulationRequest } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { SimulationPage } from './simulation-page';
import { SimulationsApi } from './simulations-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';
// 13:07Z is 10:07 in Argentina (UTC-3): the form starts at 10:15.
const NOW = Date.parse('2026-10-16T13:07:00Z');

function makeSimulation(overrides: Partial<Simulation> = {}): Simulation {
  return {
    projectId: 'p1',
    goal: 'deadline',
    startAt: '2026-10-16T10:15',
    jobs: [
      {
        order: 1,
        partId: 'a',
        partName: 'Soporte',
        unit: 1,
        unitsInLine: 2,
        printerId: 'pr1',
        startAt: '2026-10-16T10:15',
        endAt: '2026-10-16T12:15',
        handoffAt: '2026-10-16T12:30',
        unattended: false,
      },
      {
        order: 2,
        partId: 'a',
        partName: 'Soporte',
        unit: 2,
        unitsInLine: 2,
        printerId: 'pr1',
        startAt: '2026-10-16T12:30',
        endAt: '2026-10-16T20:30',
        handoffAt: '2026-10-17T08:00',
        unattended: true,
      },
    ],
    printers: [
      { printerId: 'pr1', name: 'Ender', jobs: 2, busyMinutes: 1305, idleMinutes: 0 },
      { printerId: 'pr2', name: 'Prusa', jobs: 0, busyMinutes: 0, idleMinutes: 0 },
    ],
    totals: {
      placedJobs: 2,
      unplacedJobs: 1,
      finishAt: '2026-10-17T08:00',
      totalBusyMinutes: 1305,
      totalIdleMinutes: 90,
    },
    deadline: { date: '2026-10-20', met: false },
    unplaced: [{ partId: 'b', partName: 'Tapa', units: 3 }],
    warnings: [],
    ...overrides,
  };
}

function makeOptimization(overrides: Partial<Optimization> = {}): Optimization {
  return {
    projectId: 'p1',
    goal: 'fastest',
    startAt: '2026-10-16T10:15',
    strategy: 'best_fit',
    baseline: {
      totals: {
        placedPlates: 2,
        placedUnits: 2,
        unplacedUnits: 1,
        finishAt: '2026-10-17T08:00',
        totalBusyMinutes: 1305,
        totalIdleMinutes: 90,
      },
      deadline: { date: '2026-10-20', met: false },
      unplaced: [{ partId: 'b', partName: 'Tapa', units: 1 }],
    },
    optimized: {
      jobs: [
        {
          order: 1,
          partId: 'a',
          partName: 'Soporte',
          units: 2,
          plateIndex: 1,
          platesInLine: 2,
          printerId: 'pr1',
          startAt: '2026-10-16T10:15',
          endAt: '2026-10-16T12:15',
          handoffAt: '2026-10-16T12:30',
          unattended: false,
        },
        {
          order: 2,
          partId: 'a',
          partName: 'Soporte',
          units: 1,
          plateIndex: 2,
          platesInLine: 2,
          printerId: 'pr1',
          startAt: '2026-10-16T12:30',
          endAt: '2026-10-16T20:30',
          handoffAt: '2026-10-17T03:30',
          unattended: true,
        },
      ],
      printers: [
        { printerId: 'pr1', name: 'Ender', jobs: 2, busyMinutes: 1035, idleMinutes: 0 },
        { printerId: 'pr2', name: 'Prusa', jobs: 0, busyMinutes: 0, idleMinutes: 0 },
      ],
      totals: {
        placedPlates: 2,
        placedUnits: 3,
        unplacedUnits: 0,
        finishAt: '2026-10-17T03:30',
        totalBusyMinutes: 1035,
        totalIdleMinutes: 0,
      },
      deadline: { date: '2026-10-20', met: true },
      unplaced: [],
    },
    comparison: { finishDeltaMinutes: -270, idleDeltaMinutes: -90, deadlineChanged: 'gained' },
    candidates: [
      {
        strategy: 'naive',
        finishAt: '2026-10-17T08:00',
        totalIdleMinutes: 90,
        deadlineMet: false,
        placedUnits: 2,
        unplacedUnits: 1,
      },
      {
        strategy: 'queue_order',
        finishAt: '2026-10-17T05:00',
        totalIdleMinutes: 30,
        deadlineMet: true,
        placedUnits: 3,
        unplacedUnits: 0,
      },
      {
        strategy: 'longest_first',
        finishAt: null,
        totalIdleMinutes: 0,
        deadlineMet: null,
        placedUnits: 0,
        unplacedUnits: 3,
      },
      {
        strategy: 'shortest_first',
        finishAt: '2026-10-17T06:15',
        totalIdleMinutes: 45,
        deadlineMet: true,
        placedUnits: 3,
        unplacedUnits: 0,
      },
      {
        strategy: 'best_fit',
        finishAt: '2026-10-17T03:30',
        totalIdleMinutes: 0,
        deadlineMet: true,
        placedUnits: 3,
        unplacedUnits: 0,
      },
    ],
    warnings: [{ code: 'batching_applied' }],
    ...overrides,
  };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

const plain = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

async function render() {
  const runs: { body: SimulationRequest; reply: Subject<Simulation> }[] = [];
  const optimizations: { body: SimulationRequest; reply: Subject<Optimization> }[] = [];
  const api = {
    simulate: vi.fn((body: SimulationRequest) => {
      const reply = new Subject<Simulation>();
      runs.push({ body, reply });
      return reply;
    }),
    optimize: vi.fn((body: SimulationRequest) => {
      const reply = new Subject<Optimization>();
      optimizations.push({ body, reply });
      return reply;
    }),
  };
  TestBed.configureTestingModule({
    imports: [SimulationPage],
    providers: [
      provideRouter([]),
      { provide: SimulationsApi, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(SimulationPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  await settle();
  const input = (id: string) => element.querySelector<HTMLInputElement>(`#${id}`);
  const optimizeButton = () => element.querySelector<HTMLButtonElement>('#optimize');
  const view = {
    element,
    api,
    runs,
    settle,
    input,
    q: (selector: string) => element.querySelector<HTMLElement>(selector),
    text: () => plain(element.textContent),
    async type(id: string, value: string) {
      const control = input(id);
      if (control) {
        control.value = value;
        control.dispatchEvent(new Event('input'));
      }
      await settle();
    },
    async submit() {
      element.querySelector('form')?.dispatchEvent(new Event('submit'));
      await settle();
    },
    async answer(simulation: Simulation = makeSimulation(), index = runs.length - 1) {
      runs[index]?.reply.next(simulation);
      await settle();
    },
    async fail(error: unknown) {
      runs[runs.length - 1]?.reply.error(error);
      await settle();
    },
    optimizations,
    async optimize() {
      optimizeButton()?.click();
      await settle();
    },
    async answerOptimization(
      optimization: Optimization = makeOptimization(),
      index = optimizations.length - 1,
    ) {
      optimizations[index]?.reply.next(optimization);
      await settle();
    },
    async failOptimization(error: unknown) {
      optimizations[optimizations.length - 1]?.reply.error(error);
      await settle();
    },
    optimizeButton,
    submitButton: () => element.querySelector<HTMLButtonElement>('button[type="submit"]'),
  };
  return view;
}

describe('SimulationPage', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('the form', () => {
    it('has one h1, the explanation and the start pre-filled with Argentina time rounded up', async () => {
      const page = await render();

      expect(page.element.querySelectorAll('h1')).toHaveLength(1);
      expect(page.q('h1')?.textContent).toBe('Simulación de la planificación');
      expect(page.text()).toContain('orden simple');
      expect(page.text()).toContain('ventanas de intervención');
      expect(page.text()).toContain('Argentina');
      expect(page.text()).toContain('14 días');
      expect(page.input('sim-date')?.value).toBe('16-10-2026');
      expect(page.input('sim-time')?.value).toBe('10:15');
      expect(page.element.querySelector('label[for="sim-date"]')).not.toBeNull();
      expect(page.element.querySelector('label[for="sim-time"]')).not.toBeNull();
      expect(page.api.simulate).not.toHaveBeenCalled();
    });

    it('sends projectId and startAt as YYYY-MM-DDTHH:mm', async () => {
      const page = await render();
      await page.type('sim-date', '05-11-2026');
      await page.type('sim-time', '08:30');

      await page.submit();

      expect(page.api.simulate).toHaveBeenCalledExactlyOnceWith({
        projectId: 'p1',
        startAt: '2026-11-05T08:30',
      });
    });

    it.each(['', 'ayer', '31-04-2026', '2026-10-16'])(
      'rejects the date %j without calling the API and focuses it',
      async (value) => {
        const page = await render();
        await page.type('sim-date', value);

        await page.submit();

        const field = page.input('sim-date');
        expect(field?.getAttribute('aria-invalid')).toBe('true');
        expect(field?.getAttribute('aria-describedby')).toBe('sim-date-error');
        expect(page.q('#sim-date-error')?.textContent).toContain('DD-MM-AAAA');
        expect(page.api.simulate).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(field);
      },
    );

    it.each(['', '24:00', '9:30', '12:60'])(
      'rejects the time %j without calling the API and focuses it',
      async (value) => {
        const page = await render();
        await page.type('sim-time', value);

        await page.submit();

        const field = page.input('sim-time');
        expect(field?.getAttribute('aria-invalid')).toBe('true');
        expect(page.q('#sim-time-error')?.textContent).toContain('HH:MM');
        expect(page.api.simulate).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(field);
      },
    );

    it('shows a field error while typing once the field was edited', async () => {
      const page = await render();

      await page.type('sim-time', '99:99');

      expect(page.q('#sim-time-error')).not.toBeNull();
      expect(page.q('#sim-date-error')).toBeNull();
    });
  });

  describe('running', () => {
    it('disables the button while simulating and announces it', async () => {
      const page = await render();

      await page.submit();

      expect(page.submitButton()?.disabled).toBe(true);
      expect(page.submitButton()?.textContent.trim()).toBe('Simulando…');
      expect(page.q('#sim-status')?.getAttribute('aria-live')).toBe('polite');
      expect(page.q('#sim-status')?.textContent).toContain('Simulando');
      expect(page.q('.result')?.getAttribute('aria-live')).toBeNull();
    });

    it('announces only a short status line when the result is ready', async () => {
      const page = await render();
      await page.submit();

      await page.answer();

      expect(plain(page.q('#sim-status')?.textContent)).toBe(
        'Simulación lista: 2 trabajos ubicados',
      );
    });

    it.each(['sim-date', 'sim-time'])(
      'clears the previous result when %s changes',
      async (field) => {
        const page = await render();
        await page.submit();
        await page.answer();
        expect(page.q('#summary')).not.toBeNull();

        await page.type(field, field === 'sim-date' ? '17-10-2026' : '11:00');

        expect(page.q('#summary')).toBeNull();
        expect(page.q('table')).toBeNull();
        expect(plain(page.q('#sim-status')?.textContent)).toBe('');
      },
    );

    it('reads the clock once, so date and time come from the same instant', async () => {
      // 23:55 in Argentina rolls to 00:00 of the next day; a second reading would split them.
      const lateNight = Date.parse('2026-10-17T02:55:00Z');
      vi.spyOn(Date, 'now')
        .mockReturnValueOnce(lateNight)
        .mockReturnValue(lateNight + 3_600_000);

      const page = await render();

      expect(page.input('sim-date')?.value).toBe('17-10-2026');
      expect(page.input('sim-time')?.value).toBe('00:00');
    });

    it('cancels the previous run when a new one starts', async () => {
      const page = await render();
      await page.submit();
      await page.type('sim-time', '11:00');
      await page.submit();

      await page.answer(
        makeSimulation({ unplaced: [{ partId: 'x', partName: 'VIEJA', units: 1 }] }),
        0,
      );
      expect(page.q('#summary')).toBeNull();
      await page.answer(makeSimulation(), 1);

      expect(page.api.simulate).toHaveBeenCalledTimes(2);
      expect(page.text()).not.toContain('VIEJA');
      expect(page.q('#summary')).not.toBeNull();
      expect(page.submitButton()?.disabled).toBe(false);
    });
  });

  describe('result', () => {
    it('shows the summary with formatted dates and durations', async () => {
      const page = await render();
      await page.submit();

      await page.answer();

      const summary = Array.from(page.element.querySelectorAll('#summary > div')).map((row) => [
        plain(row.querySelector('dt')?.textContent),
        plain(row.querySelector('dd')?.textContent),
      ]);
      expect(summary).toEqual([
        ['Hora de fin', '17-10-2026 08:00'],
        ['Tiempo ocupado', '21 h 45 min'],
        ['Tiempo muerto', '1 h 30 min'],
        ['Trabajos ubicados', '2'],
        ['Trabajos no ubicados', '1'],
        ['Fecha límite', '20-10-2026: no cumple'],
      ]);
      expect(page.q('.result')?.textContent).toContain('Resultado');
    });

    it.each([
      [{ date: '2026-10-20', met: true }, '20-10-2026: cumple'],
      [{ date: null, met: null }, 'Sin fecha límite'],
    ])('words the deadline %j as %s', async (deadline, text) => {
      const page = await render();
      await page.submit();

      await page.answer(makeSimulation({ deadline }));

      expect(page.text()).toContain(text);
    });

    it('lists the unplaced parts', async () => {
      const page = await render();
      await page.submit();

      await page.answer();

      expect(plain(page.q('#unplaced')?.textContent)).toBe('Tapa: 3 unidad(es)');
    });

    it('shows one table per printer with piece, dates and the Sin atender badge', async () => {
      const page = await render();
      await page.submit();

      await page.answer();

      const rows = Array.from(page.element.querySelectorAll('tbody tr')).map((row) =>
        Array.from(row.children).map((cell) => plain(cell.textContent)),
      );
      expect(rows).toEqual([
        ['1', 'Soporte (1 de 2)', '16-10-2026 10:15', '16-10-2026 12:15', '16-10-2026 12:30', ''],
        [
          '2',
          'Soporte (2 de 2)',
          '16-10-2026 12:30',
          '16-10-2026 20:30',
          '17-10-2026 08:00',
          'Sin atender',
        ],
      ]);
      expect(page.element.querySelectorAll('.badge')).toHaveLength(1);
      expect(page.text()).toContain('Prusa');
      expect(page.text()).toContain('Sin trabajos en esta impresora');
    });

    it('draws accessible-equivalent timeline bars hidden from assistive technology', async () => {
      const page = await render();
      await page.submit();

      await page.answer();

      const timeline = page.q('.timeline');
      expect(timeline?.getAttribute('aria-hidden')).toBe('true');
      const bars = Array.from(page.element.querySelectorAll<HTMLElement>('.bar'));
      expect(bars).toHaveLength(2);
      expect(bars[0]?.getAttribute('title')).toBe(
        'Soporte (1 de 2): 16-10-2026 10:15 a 16-10-2026 12:30',
      );
      // 14 days = 20160 min: the second job starts 135 min in and lasts 1170 min.
      expect(bars[1]?.style.left).toBe(`${(135 / 20160) * 100}%`);
      expect(bars[1]?.style.width).toBe(`${(1170 / 20160) * 100}%`);
    });

    it.each([
      ['part_deleted', 'piezas eliminadas'],
      ['printer_unavailable', 'ya no está disponible'],
      ['availability_not_configured', 'ventanas de intervención'],
      ['nothing_to_print', 'no tiene unidades pendientes'],
    ] as const)('explains the warning %s in Spanish without the code', async (code, text) => {
      const page = await render();
      await page.submit();

      await page.answer(makeSimulation({ warnings: [{ code }] }));

      const item = page.q('.warnings li');
      expect(item?.textContent).toContain(text);
      expect(item?.querySelector('[aria-hidden="true"]')?.textContent).toBe('⚠');
      expect(page.q('.result')?.textContent).not.toContain(code);
    });

    it('says there are no placed jobs instead of an end time', async () => {
      const page = await render();
      await page.submit();

      await page.answer(
        makeSimulation({
          jobs: [],
          printers: [],
          deadline: { date: '2026-10-20', met: null },
          totals: {
            placedJobs: 0,
            unplacedJobs: 3,
            finishAt: null,
            totalBusyMinutes: 0,
            totalIdleMinutes: 0,
          },
        }),
      );

      expect(page.text()).toContain('Sin trabajos ubicados');
      expect(page.text()).toContain('20-10-2026: sin trabajos ubicados para evaluar');
    });

    it('renders hostile names as plain text', async () => {
      const page = await render();
      const hostile = '<img src=x onerror=alert(1)>';
      await page.submit();

      await page.answer(
        makeSimulation({ unplaced: [{ partId: 'h', partName: hostile, units: 1 }] }),
      );

      expect(page.element.querySelector('img')).toBeNull();
      expect(page.q('#unplaced')?.textContent).toContain(hostile);
    });
  });

  describe('errors', () => {
    it('offers a link to the queue when the project has none (400 on projectId)', async () => {
      const page = await render();
      await page.submit();

      await page.fail(problem(400, [{ path: 'projectId', message: SENTINEL }]));

      expect(page.q('#no-queue')?.textContent).toContain('todavía no tiene una cola');
      expect(page.q('#no-queue a')?.getAttribute('href')).toBe('/proyectos/p1/cola');
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.submitButton()?.disabled).toBe(false);
    });

    it('maps a lines issue (too many pending units) to a fixed message', async () => {
      const page = await render();
      await page.submit();

      await page.fail(problem(400, [{ path: 'lines', message: SENTINEL }]));

      expect(plain(page.q('[role="alert"]')?.textContent)).toContain(
        'demasiadas unidades pendientes',
      );
      expect(page.q('#no-queue')).toBeNull();
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('maps a printerIds issue to a fixed message with a link to the queue', async () => {
      const page = await render();
      await page.submit();

      await page.fail(problem(400, [{ path: 'printerIds', message: SENTINEL }]));

      expect(plain(page.q('[role="alert"]')?.textContent)).toContain('impresoras elegidas');
      expect(page.q('[role="alert"] a')?.getAttribute('href')).toBe('/proyectos/p1/cola');
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('maps a startAt issue to a fixed message', async () => {
      const page = await render();
      await page.submit();

      await page.fail(problem(400, [{ path: 'startAt', message: SENTINEL }]));

      expect(plain(page.q('[role="alert"]')?.textContent)).toContain('fecha y la hora de inicio');
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('shows the safe message for a 503, never backend text, and does not retry', async () => {
      const page = await render();
      await page.submit();

      await page.fail(problem(503));

      expect(plain(page.q('[role="alert"]')?.textContent)).toBe('Mensaje seguro en español.');
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.api.simulate).toHaveBeenCalledTimes(1);
      expect(page.submitButton()?.disabled).toBe(false);
    });

    it('shows a generic message when the error is not an ApiError', async () => {
      const page = await render();
      await page.submit();

      await page.fail(new Error(SENTINEL));

      expect(plain(page.q('[role="alert"]')?.textContent)).toContain('Ocurrió un error inesperado');
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('lets the user simulate again after a failure', async () => {
      const page = await render();
      await page.submit();
      await page.fail(problem(503));

      await page.submit();
      await page.answer();

      expect(page.api.simulate).toHaveBeenCalledTimes(2);
      expect(page.q('[role="alert"]')).toBeNull();
      expect(page.q('#summary')).not.toBeNull();
    });
  });

  describe('the optimiser', () => {
    const table = (page: Awaited<ReturnType<typeof render>>, selector: string) =>
      Array.from(page.element.querySelectorAll(`${selector} tbody tr`)).map((row) =>
        Array.from(row.children).map((cell) => plain(cell.textContent)),
      );

    it('links to the planning settings from the page', async () => {
      const page = await render();

      expect(page.q('a[href="/planificacion/ajustes"]')?.textContent).toBe(
        'Ajustes de planificación',
      );
      expect(plain(page.optimizeButton()?.textContent)).toBe('Optimizar y comparar');
    });

    it('sends the same start as the simulation to the optimiser, not to the simulator', async () => {
      const page = await render();
      await page.type('sim-date', '05-11-2026');
      await page.type('sim-time', '08:30');

      await page.optimize();

      expect(page.api.optimize).toHaveBeenCalledExactlyOnceWith({
        projectId: 'p1',
        startAt: '2026-11-05T08:30',
      });
      expect(page.api.simulate).not.toHaveBeenCalled();
    });

    it('rejects an invalid date without calling the API and focuses it', async () => {
      const page = await render();
      await page.type('sim-date', '31-04-2026');

      await page.optimize();

      expect(page.api.optimize).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(page.input('sim-date'));
    });

    it('disables both buttons while optimizing and announces it', async () => {
      const page = await render();

      await page.optimize();

      expect(page.optimizeButton()?.disabled).toBe(true);
      expect(plain(page.optimizeButton()?.textContent)).toBe('Optimizando…');
      expect(page.submitButton()?.disabled).toBe(true);
      expect(plain(page.q('#sim-status')?.textContent)).toBe('Optimizando…');
      expect(page.q('#sim-status')?.getAttribute('aria-live')).toBe('polite');
    });

    it('announces only a short status line when the result is ready', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization();

      expect(plain(page.q('#sim-status')?.textContent)).toBe(
        'Optimización lista: Mejor encaje con tus ventanas',
      );
      expect(page.optimizeButton()?.disabled).toBe(false);
    });

    it('explains what was done in plain Spanish and names the chosen strategy', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization();

      expect(plain(page.q('#explanation')?.textContent)).toBe(
        'Probamos 5 estrategias y elegimos la mejor según el objetivo: terminar lo antes posible.',
      );
      expect(plain(page.q('#chosen')?.textContent)).toBe(
        'Estrategia elegida: Mejor encaje con tus ventanas',
      );
    });

    it.each([
      ['deadline', 'cumplir la fecha límite'],
      ['minimal_idle', 'tener el menor tiempo muerto'],
    ] as const)('words the goal %s as "%s"', async (goal, text) => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization(makeOptimization({ goal }));

      expect(plain(page.q('#explanation')?.textContent)).toContain(`el objetivo: ${text}.`);
    });

    it('shows the naive plan and the optimised plan side by side with exact figures', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization();

      expect(
        Array.from(page.element.querySelectorAll('#comparison thead th')).map((th) =>
          plain(th.textContent),
        ),
      ).toEqual(['Dato', 'Orden simple', 'Optimizado']);
      expect(table(page, '#comparison')).toEqual([
        ['Hora de fin', '17-10-2026 08:00', '17-10-2026 03:30'],
        ['Tiempo ocupado', '21 h 45 min', '17 h 15 min'],
        ['Tiempo muerto', '1 h 30 min', '0 min'],
        ['Piezas ubicadas', '2', '3'],
        ['Piezas no ubicadas', '1', '0'],
        ['Placas impresas', '2', '2'],
        ['Fecha límite', '20-10-2026: no cumple', '20-10-2026: cumple'],
      ]);
    });

    it('words the improvement: finishes earlier, less idle time, deadline gained', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization();

      expect(
        Array.from(page.element.querySelectorAll('#deltas li')).map((li) => li.textContent),
      ).toEqual([
        'Termina 4 h 30 min antes.',
        'Tiempo muerto: 1 h 30 min menos.',
        'Ahora cumple la fecha límite.',
      ]);
    });

    it.each([
      ['lost', 'Ya no cumple la fecha límite.'],
      ['same', 'La fecha límite queda igual.'],
      ['unknown', 'No se puede comparar la fecha límite.'],
    ] as const)('words a deadline that is %s', async (deadlineChanged, text) => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization(
        makeOptimization({
          comparison: { finishDeltaMinutes: 0, idleDeltaMinutes: 0, deadlineChanged },
        }),
      );

      expect(
        Array.from(page.element.querySelectorAll('#deltas li')).map((li) => li.textContent),
      ).toEqual(['Sin diferencia en la hora de fin.', 'Sin diferencia en el tiempo muerto.', text]);
    });

    it('says the finish cannot be compared when only one plan placed anything', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization(
        makeOptimization({
          comparison: { finishDeltaMinutes: null, idleDeltaMinutes: 0, deadlineChanged: 'unknown' },
        }),
      );

      expect(page.q('#deltas li')?.textContent).toBe('No se puede comparar la hora de fin.');
    });

    it('lists every candidate with a Spanish label and marks the chosen row', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization();

      expect(table(page, '#candidates')).toEqual([
        ['Orden simple', '17-10-2026 08:00', '1 h 30 min', 'No cumple', '2', '1'],
        ['Orden de la cola agrupando piezas', '17-10-2026 05:00', '30 min', 'Cumple', '3', '0'],
        ['Las más largas primero', 'Sin trabajos ubicados', '0 min', 'No aplica', '0', '3'],
        ['Las más cortas primero', '17-10-2026 06:15', '45 min', 'Cumple', '3', '0'],
        ['Mejor encaje con tus ventanas Elegida', '17-10-2026 03:30', '0 min', 'Cumple', '3', '0'],
      ]);
      const chosen = page.element.querySelectorAll('#candidates tr.chosen');
      expect(chosen).toHaveLength(1);
      expect(plain(chosen[0]?.querySelector('th')?.textContent)).toContain('Mejor encaje');
    });

    it('shows the optimised plan with pieces per plate, plate x of y and Sin atender', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization();

      expect(page.text()).toContain('Plan optimizado');
      expect(table(page, '.printer')).toEqual([
        [
          '1',
          'Soporte: 2 piezas por placa (placa 1 de 2)',
          '16-10-2026 10:15',
          '16-10-2026 12:15',
          '16-10-2026 12:30',
          '',
        ],
        [
          '2',
          'Soporte: 1 pieza por placa (placa 2 de 2)',
          '16-10-2026 12:30',
          '16-10-2026 20:30',
          '17-10-2026 03:30',
          'Sin atender',
        ],
      ]);
      expect(page.text()).toContain('Sin trabajos en esta impresora');
      const bars = Array.from(page.element.querySelectorAll<HTMLElement>('.bar'));
      expect(bars).toHaveLength(2);
      // 14 days = 20160 min: the second plate starts 135 min in and lasts 900 min to its handoff.
      expect(bars[1]?.style.left).toBe(`${(135 / 20160) * 100}%`);
      expect(bars[1]?.style.width).toBe(`${(900 / 20160) * 100}%`);
      expect(page.q('.timeline')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('explains the batching warning in Spanish without the code', async () => {
      const page = await render();
      await page.optimize();

      await page.answerOptimization();

      expect(plain(page.q('.warnings li')?.textContent)).toBe(
        '⚠ Se agruparon piezas iguales en una misma placa.',
      );
      expect(page.q('.result')?.textContent).not.toContain('batching_applied');
    });

    it('lists what could not be placed by the optimised plan', async () => {
      const page = await render();
      await page.optimize();
      const base = makeOptimization();

      await page.answerOptimization(
        makeOptimization({
          optimized: { ...base.optimized, unplaced: [{ partId: 'b', partName: 'Tapa', units: 2 }] },
        }),
      );

      expect(plain(page.q('#unplaced')?.textContent)).toBe('Tapa: 2 unidad(es)');
    });

    it('renders hostile names as plain text', async () => {
      const page = await render();
      await page.optimize();
      const base = makeOptimization();
      const hostile = '<img src=x onerror=alert(1)>';

      await page.answerOptimization(
        makeOptimization({
          optimized: {
            ...base.optimized,
            unplaced: [{ partId: 'h', partName: hostile, units: 1 }],
          },
        }),
      );

      expect(page.element.querySelector('img')).toBeNull();
      expect(page.q('#unplaced')?.textContent).toContain(hostile);
    });

    it.each(['sim-date', 'sim-time'])(
      'clears the previous optimisation when %s changes',
      async (field) => {
        const page = await render();
        await page.optimize();
        await page.answerOptimization();
        expect(page.q('#comparison')).not.toBeNull();

        await page.type(field, field === 'sim-date' ? '17-10-2026' : '11:00');

        expect(page.q('#comparison')).toBeNull();
        expect(page.q('#candidates')).toBeNull();
        expect(plain(page.q('#sim-status')?.textContent)).toBe('');
      },
    );

    it('keeps only the latest run when a new one starts', async () => {
      const page = await render();
      await page.optimize();
      await page.type('sim-time', '11:00');
      await page.optimize();

      await page.answerOptimization(
        makeOptimization({
          optimized: {
            ...makeOptimization().optimized,
            unplaced: [{ partId: 'x', partName: 'VIEJA', units: 1 }],
          },
        }),
        0,
      );
      expect(page.q('#comparison')).toBeNull();
      await page.answerOptimization(makeOptimization(), 1);

      expect(page.api.optimize).toHaveBeenCalledTimes(2);
      expect(page.text()).not.toContain('VIEJA');
      expect(page.q('#comparison')).not.toBeNull();
    });

    it('replaces a simulation result when optimizing, and the other way round', async () => {
      const page = await render();
      await page.submit();
      await page.answer();
      expect(page.q('#summary')).not.toBeNull();

      await page.optimize();
      await page.answerOptimization();

      expect(page.q('#summary')).toBeNull();
      expect(page.q('#comparison')).not.toBeNull();
    });

    describe('errors', () => {
      it('offers a link to the queue when the project has none (400 on projectId)', async () => {
        const page = await render();
        await page.optimize();

        await page.failOptimization(problem(400, [{ path: 'projectId', message: SENTINEL }]));

        expect(page.q('#no-queue')?.textContent).toContain('todavía no tiene una cola');
        expect(page.q('#no-queue a')?.getAttribute('href')).toBe('/proyectos/p1/cola');
        expect(page.text()).not.toContain(SENTINEL);
        expect(page.optimizeButton()?.disabled).toBe(false);
      });

      it.each([
        ['lines', 'demasiadas unidades pendientes'],
        ['printerIds', 'impresoras elegidas'],
        ['startAt', 'fecha y la hora de inicio'],
      ])('maps an issue on %s to a fixed message', async (path, text) => {
        const page = await render();
        await page.optimize();

        await page.failOptimization(problem(400, [{ path, message: SENTINEL }]));

        expect(plain(page.q('[role="alert"]')?.textContent)).toContain(text);
        expect(page.text()).not.toContain(SENTINEL);
      });

      it('shows the safe message for a 503, never backend text, and does not retry', async () => {
        const page = await render();
        await page.optimize();

        await page.failOptimization(problem(503));

        expect(plain(page.q('[role="alert"]')?.textContent)).toBe('Mensaje seguro en español.');
        expect(page.text()).not.toContain(SENTINEL);
        expect(page.api.optimize).toHaveBeenCalledTimes(1);
        expect(page.optimizeButton()?.disabled).toBe(false);
      });

      it('shows a generic message when the error is not an ApiError', async () => {
        const page = await render();
        await page.optimize();

        await page.failOptimization(new Error(SENTINEL));

        expect(plain(page.q('[role="alert"]')?.textContent)).toContain(
          'Ocurrió un error inesperado',
        );
        expect(page.text()).not.toContain(SENTINEL);
      });
    });
  });
});
