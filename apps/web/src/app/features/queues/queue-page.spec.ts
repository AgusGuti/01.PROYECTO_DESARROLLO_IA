import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { CreateQueueRequest, Queue, UpdateQueueRequest } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { formatDuration, parseQuantity } from './queue-labels';
import { QueuePage } from './queue-page';
import { type PrinterOption, type ProjectSnapshot, QueuesApi } from './queues-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

const PRINTERS: readonly PrinterOption[] = [
  { id: 'pr1', name: 'Ender 3' },
  { id: 'pr2', name: 'Prusa' },
  { id: 'pr3', name: 'Bambu' },
];

const PROJECT: ProjectSnapshot = {
  name: 'Soportes',
  lines: [
    { partId: 'a', name: 'Soporte de cable', quantity: 3 },
    { partId: 'b', name: 'Tapa', quantity: 2 },
  ],
};

function makeQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    projectId: 'p1',
    goal: 'deadline',
    mode: 'single',
    printerIds: ['pr1'],
    lines: [
      {
        partId: 'a',
        quantity: 3,
        completed: 1,
        pendingUnits: 2,
        partName: 'Soporte de cable',
        estimatedPrintSeconds: 3600,
        partDeleted: false,
      },
      {
        partId: 'b',
        quantity: 2,
        completed: 0,
        pendingUnits: 2,
        partName: null,
        estimatedPrintSeconds: null,
        partDeleted: true,
      },
    ],
    totals: { totalUnits: 5, completedUnits: 1, pendingUnits: 4, pendingSeconds: 9000 },
    version: 7,
    createdAt: '2026-10-16T10:00:00.000Z',
    updatedAt: '2026-10-16T10:00:00.000Z',
    ...overrides,
  };
}

function withLine(queue: Queue, index: number, overrides: Partial<Queue['lines'][number]>) {
  const base = queue.lines[index];
  if (base === undefined) throw new Error('no such line');
  return { ...base, ...overrides };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

async function render() {
  const gets: Subject<Queue | null>[] = [];
  const printerReplies: Subject<readonly PrinterOption[]>[] = [];
  const projectReplies: Subject<ProjectSnapshot>[] = [];
  const creates: { body: CreateQueueRequest; reply: Subject<Queue> }[] = [];
  const updates: { body: UpdateQueueRequest; reply: Subject<Queue> }[] = [];
  const removes: { version: number; reply: Subject<void> }[] = [];

  const api = {
    get: vi.fn((_id: string) => {
      const reply = new Subject<Queue | null>();
      gets.push(reply);
      return reply;
    }),
    printers: vi.fn(() => {
      const reply = new Subject<readonly PrinterOption[]>();
      printerReplies.push(reply);
      return reply;
    }),
    project: vi.fn((_id: string) => {
      const reply = new Subject<ProjectSnapshot>();
      projectReplies.push(reply);
      return reply;
    }),
    create: vi.fn((body: CreateQueueRequest) => {
      const reply = new Subject<Queue>();
      creates.push({ body, reply });
      return reply;
    }),
    update: vi.fn((_id: string, body: UpdateQueueRequest) => {
      const reply = new Subject<Queue>();
      updates.push({ body, reply });
      return reply;
    }),
    remove: vi.fn((_id: string, version: number) => {
      const reply = new Subject<void>();
      removes.push({ version, reply });
      return reply;
    }),
  };
  TestBed.configureTestingModule({
    imports: [QueuePage],
    providers: [
      provideRouter([]),
      { provide: QueuesApi, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(QueuePage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const q = (selector: string) => element.querySelector<HTMLElement>(selector);
  const narrowTo = <T extends HTMLElement>(
    node: HTMLElement | null,
    type: new () => T,
  ): T | null => (node instanceof type ? node : null);
  const input = (selector: string) => narrowTo(q(selector), HTMLInputElement);
  const select = (selector: string) => narrowTo(q(selector), HTMLSelectElement);
  const btn = (selector: string) => narrowTo(q(selector), HTMLButtonElement);
  const progressBar = (selector: string) => narrowTo(q(selector), HTMLProgressElement);
  const button = (text: string) =>
    Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
  const text = () => element.textContent.replace(/\s+/g, ' ');

  return {
    api,
    element,
    gets,
    printerReplies,
    projectReplies,
    creates,
    updates,
    removes,
    settle,
    q,
    input,
    select,
    btn,
    progressBar,
    button,
    text,
    /** Answers the queue GET (null = 404) and the printers (and project when there is no queue). */
    async open(queue: Queue | null) {
      gets[0]?.next(queue);
      gets[0]?.complete();
      printerReplies[0]?.next(PRINTERS);
      printerReplies[0]?.complete();
      if (queue === null) {
        projectReplies[0]?.next(PROJECT);
        projectReplies[0]?.complete();
      }
      await settle();
    },
    async click(target: HTMLElement | null | undefined) {
      target?.click();
      await settle();
    },
    async type(input: HTMLInputElement | null, value: string) {
      if (input === null) return;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    },
    async choose(select: HTMLSelectElement | null, value: string) {
      if (select === null) return;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle();
    },
  };
}

describe('QueuePage', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });

  it('shows one h1 and a loading status, then the loaded view', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.q('h1')?.textContent).toBe('Cola de impresión');
    await page.settle();
    expect(page.text()).toContain('Cargando la cola');

    await page.open(makeQueue());

    expect(page.text()).not.toContain('Cargando la cola');
    expect(page.q('#totals')).not.toBeNull();
  });

  it('shows a safe message and Reintentar when the queue cannot be read, never backend text', async () => {
    const page = await render();

    page.gets[0]?.error(problem(503));
    await page.settle();

    expect(page.q('[role="alert"]')?.textContent).toContain('Mensaje seguro en español.');
    expect(page.element.textContent).not.toContain(SENTINEL);

    await page.click(page.button('Reintentar'));
    expect(page.api.get).toHaveBeenCalledTimes(2);
  });

  it('fails safely when the printers cannot be read', async () => {
    const page = await render();

    page.gets[0]?.next(null);
    page.printerReplies[0]?.error(problem(503));
    page.projectReplies[0]?.next(PROJECT);
    await page.settle();

    expect(page.q('[role="alert"]')?.textContent).toContain('Mensaje seguro en español.');
    expect(page.button('Reintentar')).toBeDefined();
  });

  describe('without a queue yet', () => {
    it('is not an error: shows the creation form prefilled from the project', async () => {
      const page = await render();

      await page.open(null);

      expect(page.q('[role="alert"]')).toBeNull();
      expect(page.q('#no-queue')?.textContent).toContain('todavía no tiene una cola');
      const names = Array.from(page.element.querySelectorAll('tbody th')).map(
        (th) => th.textContent,
      );
      expect(names).toEqual(['Soporte de cable', 'Tapa']);
      expect(page.input('#line-0-quantity')?.value).toBe('3');
      expect(page.button('Crear cola')).toBeDefined();
      expect(page.button('Eliminar cola')).toBeUndefined();
    });

    it('offers the three goals and both modes with their Spanish labels', async () => {
      const page = await render();

      await page.open(null);

      const goals = Array.from(page.element.querySelectorAll('#queue-goal option')).map((option) =>
        option.textContent.trim(),
      );
      expect(goals).toEqual([
        'Cumplir las fechas límite',
        'Terminar lo antes posible',
        'Minimizar tiempos muertos',
      ]);
      expect(page.text()).toContain('Una impresora');
      expect(page.text()).toContain('Varias impresoras');
    });

    it('creates the queue with the chosen values and moves to the ready view', async () => {
      const page = await render();
      await page.open(null);
      await page.choose(page.select('#queue-goal'), 'fastest');
      await page.choose(page.select('#queue-printer'), 'pr2');
      await page.type(page.input('#line-0-quantity'), '5');
      await page.click(
        page.element.querySelector<HTMLButtonElement>('tbody tr:nth-child(2) button'),
      );

      await page.click(page.button('Crear cola'));

      expect(page.creates).toHaveLength(1);
      expect(page.creates[0]?.body).toEqual({
        projectId: 'p1',
        goal: 'fastest',
        mode: 'single',
        printerIds: ['pr2'],
        lines: [{ partId: 'a', quantity: 5 }],
      });
      expect(page.button('Creando…')?.disabled).toBe(true);

      page.creates[0]?.reply.next(makeQueue({ goal: 'fastest', printerIds: ['pr2'] }));
      page.creates[0]?.reply.complete();
      await page.settle();

      expect(page.q('#totals')).not.toBeNull();
      expect(page.button('Guardar cambios')).toBeDefined();
      expect(page.text()).toContain('La cola se creó.');
    });

    it('does not send a second create while the first is in flight', async () => {
      const page = await render();
      await page.open(null);
      await page.choose(page.select('#queue-printer'), 'pr1');

      await page.click(page.button('Crear cola'));
      page.q('form')?.dispatchEvent(new Event('submit'));
      await page.settle();

      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('blocks the submit and focuses the printer when none is chosen', async () => {
      const page = await render();
      await page.open(null);

      await page.click(page.button('Crear cola'));

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.q('#queue-printer-error')?.textContent).toContain('Elegí una impresora.');
      expect(document.activeElement).toBe(page.q('#queue-printer'));
    });

    it('lists the printers as checkboxes in multi mode and needs two to ten', async () => {
      const page = await render();
      await page.open(null);

      // The second radio is "Varias impresoras" (the value lives in the forms directive, not the DOM).
      const radios = Array.from(
        page.element.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      );
      await page.click(radios[1]);

      const boxes = page.element.querySelectorAll<HTMLInputElement>(
        '#queue-printers input[type="checkbox"]',
      );
      expect(boxes).toHaveLength(3);
      await page.click(boxes[0]);
      await page.click(page.button('Crear cola'));
      expect(page.q('#queue-printers-error')?.textContent).toContain(
        'Elegí entre 2 y 10 impresoras.',
      );
      expect(document.activeElement).toBe(page.q('#queue-printers'));

      await page.click(page.element.querySelectorAll<HTMLInputElement>('#queue-printers input')[2]);
      await page.click(page.button('Crear cola'));
      expect(page.creates[0]?.body.printerIds).toEqual(['pr1', 'pr3']);
      expect(page.creates[0]?.body.mode).toBe('multi');
    });

    it('rejects a quantity outside 1..1000 before sending', async () => {
      const page = await render();
      await page.open(null);
      await page.choose(page.select('#queue-printer'), 'pr1');
      await page.type(page.input('#line-1-quantity'), '1001');

      await page.click(page.button('Crear cola'));

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.q('#line-1-error')?.textContent).toContain('entre 1 y 1000');
      expect(document.activeElement).toBe(page.q('#line-1-quantity'));
    });

    it('maps 400 issues to the fields with fixed messages, never backend text', async () => {
      const page = await render();
      await page.open(null);
      await page.choose(page.select('#queue-printer'), 'pr1');
      await page.click(page.button('Crear cola'));

      page.creates[0]?.reply.error(
        problem(400, [
          { path: 'lines.1.partId', message: SENTINEL },
          { path: 'printerIds.0', message: SENTINEL },
        ]),
      );
      await page.settle();

      expect(page.q('#line-1-error')?.textContent).toContain('La pieza no es válida.');
      expect(page.q('#queue-printer-error')?.textContent).toContain('Revisá las impresoras');
      expect(page.q('#action-error')?.textContent).toContain('Revisá los datos marcados');
      expect(page.element.textContent).not.toContain(SENTINEL);
      expect(page.button('Crear cola')?.disabled).toBe(false);
    });

    it('offers Recargar on a duplicate (409) and reloads', async () => {
      const page = await render();
      await page.open(null);
      await page.choose(page.select('#queue-printer'), 'pr1');
      await page.click(page.button('Crear cola'));

      page.creates[0]?.reply.error(problem(409, [{ path: 'projectId', message: SENTINEL }]));
      await page.settle();

      expect(page.q('#action-error')?.textContent).toContain('ya tiene una cola');
      expect(page.element.textContent).not.toContain(SENTINEL);
      await page.click(page.button('Recargar'));
      expect(page.api.get).toHaveBeenCalledTimes(2);
    });

    it('shows a safe message on 503 without backend text', async () => {
      const page = await render();
      await page.open(null);
      await page.choose(page.select('#queue-printer'), 'pr1');
      await page.click(page.button('Crear cola'));

      page.creates[0]?.reply.error(problem(503));
      await page.settle();

      expect(page.q('#action-error')?.textContent).toContain('Mensaje seguro en español.');
      expect(page.element.textContent).not.toContain(SENTINEL);
    });

    it('says when there are no active printers', async () => {
      const page = await render();

      page.gets[0]?.next(null);
      page.gets[0]?.complete();
      page.printerReplies[0]?.next([]);
      page.printerReplies[0]?.complete();
      page.projectReplies[0]?.next(PROJECT);
      page.projectReplies[0]?.complete();
      await page.settle();

      expect(page.q('#no-printers')?.textContent).toContain('No hay impresoras activas');
    });
  });

  describe('with a queue', () => {
    it('shows goal, mode, printer, lines and totals', async () => {
      const page = await render();

      await page.open(makeQueue());

      expect(page.select('#queue-goal')?.value).toBe('deadline');
      expect(page.select('#queue-printer')?.value).toBe('pr1');
      const labels = Array.from(page.element.querySelectorAll('#totals dt')).map((dt) =>
        dt.textContent.trim(),
      );
      const values = Array.from(page.element.querySelectorAll('#totals dd')).map((dd) =>
        dd.textContent.trim(),
      );
      expect(labels).toEqual(['Unidades pendientes', 'Tiempo pendiente', 'Unidades completadas']);
      expect(values).toEqual(['4', '2 h 30 min', '1 de 5']);
      const names = Array.from(page.element.querySelectorAll('tbody th')).map(
        (th) => th.textContent,
      );
      expect(names).toEqual(['Soporte de cable', 'Pieza eliminada']);
    });

    it('gives each progress bar an accessible label like "1 de 3 impresas"', async () => {
      const page = await render();

      await page.open(makeQueue());

      const bar = page.progressBar('tbody tr progress');
      expect(bar?.getAttribute('aria-label')).toBe('1 de 3 impresas');
      expect(bar?.max).toBe(3);
      expect(bar?.value).toBe(1);
    });

    it('adds one printed unit with a PATCH carrying the version and keeps focus on the button', async () => {
      const page = await render();
      await page.open(makeQueue());

      await page.click(page.q('#line-0-plus') ?? undefined);

      expect(page.updates[0]?.body).toEqual({
        version: 7,
        lines: [
          { partId: 'a', quantity: 3, completed: 2 },
          { partId: 'b', quantity: 2, completed: 0 },
        ],
      });
      expect(page.btn('#line-0-plus')?.disabled).toBe(true);
      expect(page.btn('#line-1-plus')?.disabled).toBe(true);

      const saved = makeQueue({ version: 8 });
      saved.lines[0] = withLine(saved, 0, { completed: 2, pendingUnits: 1 });
      page.updates[0]?.reply.next(saved);
      page.updates[0]?.reply.complete();
      await page.settle();

      expect(page.q('tbody tr progress')?.getAttribute('aria-label')).toBe('2 de 3 impresas');
      expect(page.text()).toContain('Se actualizó el avance.');
      expect(document.activeElement).toBe(page.q('#line-0-plus'));
    });

    it('never goes below 0 or above the quantity', async () => {
      const page = await render();
      await page.open(makeQueue());

      expect(page.btn('#line-1-minus')?.disabled).toBe(true);
      await page.click(page.btn('#line-1-minus') ?? undefined);
      expect(page.api.update).not.toHaveBeenCalled();
    });

    it('disables +1 when the line is already complete', async () => {
      const full = makeQueue();
      full.lines[0] = withLine(full, 0, { completed: 3, pendingUnits: 0 });
      const page = await render();

      await page.open(full);

      expect(page.btn('#line-0-plus')?.disabled).toBe(true);
    });

    it('moves focus to the other button when a limit is reached', async () => {
      const queue = makeQueue();
      queue.lines[0] = withLine(queue, 0, { completed: 2, pendingUnits: 1 });
      const page = await render();
      await page.open(queue);
      await page.click(page.q('#line-0-plus') ?? undefined);

      const saved = makeQueue({ version: 8 });
      saved.lines[0] = withLine(saved, 0, { completed: 3, pendingUnits: 0 });
      page.updates[0]?.reply.next(saved);
      page.updates[0]?.reply.complete();
      await page.settle();

      expect(document.activeElement).toBe(page.q('#line-0-minus'));
    });

    it('saves only what changed, with the version', async () => {
      const page = await render();
      await page.open(makeQueue());
      await page.choose(page.select('#queue-goal'), 'minimal_idle');
      await page.type(page.input('#line-0-quantity'), '4');

      await page.click(page.button('Guardar cambios'));

      expect(page.updates[0]?.body).toEqual({
        version: 7,
        goal: 'minimal_idle',
        lines: [
          { partId: 'a', quantity: 4, completed: 1 },
          { partId: 'b', quantity: 2, completed: 0 },
        ],
      });
      expect(page.button('Guardando…')?.disabled).toBe(true);
    });

    it('says there is nothing to save instead of sending an empty patch', async () => {
      const page = await render();
      await page.open(makeQueue());

      await page.click(page.button('Guardar cambios'));

      expect(page.api.update).not.toHaveBeenCalled();
      expect(page.text()).toContain('No hay cambios para guardar.');
    });

    it('offers Recargar on a stale version (409) and shows no backend text', async () => {
      const page = await render();
      await page.open(makeQueue());
      await page.click(page.q('#line-0-plus') ?? undefined);

      page.updates[0]?.reply.error(problem(409));
      await page.settle();

      expect(page.q('#action-error')?.textContent).toContain('La cola cambió');
      expect(page.element.textContent).not.toContain(SENTINEL);
      await page.click(page.button('Recargar'));
      expect(page.api.get).toHaveBeenCalledTimes(2);
    });

    it('marks the quantity of a line the API rejected (lines.N.quantity)', async () => {
      const page = await render();
      await page.open(makeQueue());
      await page.type(page.input('#line-1-quantity'), '1');
      await page.click(page.button('Guardar cambios'));

      page.updates[0]?.reply.error(
        problem(400, [{ path: 'lines.1.completed', message: SENTINEL }]),
      );
      await page.settle();

      expect(page.q('#line-1-error')?.textContent).toContain('más unidades impresas');
      expect(page.element.textContent).not.toContain(SENTINEL);
      expect(document.activeElement).toBe(page.q('#line-1-quantity'));
    });

    it('marks mode and goal issues on their fields', async () => {
      const page = await render();
      await page.open(makeQueue());
      await page.choose(page.select('#queue-goal'), 'fastest');
      await page.click(page.button('Guardar cambios'));

      page.updates[0]?.reply.error(
        problem(400, [
          { path: 'goal', message: SENTINEL },
          { path: 'mode', message: SENTINEL },
        ]),
      );
      await page.settle();

      expect(page.q('#queue-goal-error')?.textContent).toContain('El objetivo no es válido.');
      expect(page.q('#queue-mode-error')?.textContent).toContain('El modo no es válido');
      expect(page.element.textContent).not.toContain(SENTINEL);
    });

    it('removes a deleted-part line with a PATCH of the remaining lines and keeps +1 working', async () => {
      const page = await render();
      await page.open(makeQueue());
      expect(page.btn('#line-0-remove')).toBeNull();

      await page.click(page.btn('#line-1-remove'));

      expect(page.updates[0]?.body).toEqual({
        version: 7,
        lines: [{ partId: 'a', quantity: 3, completed: 1 }],
      });
      const saved = makeQueue({
        version: 8,
        lines: [makeQueue().lines[0] ?? withLine(makeQueue(), 0, {})],
      });
      page.updates[0]?.reply.next(saved);
      page.updates[0]?.reply.complete();
      await page.settle();
      const names = Array.from(page.element.querySelectorAll('tbody th')).map(
        (th) => th.textContent,
      );
      expect(names).toEqual(['Soporte de cable']);
      expect(document.activeElement).toBe(page.q('#queue-title'));

      await page.click(page.btn('#line-0-plus'));
      expect(page.updates[1]?.body).toEqual({
        version: 8,
        lines: [{ partId: 'a', quantity: 3, completed: 2 }],
      });
    });

    it('keeps +1 and -1 working on other lines while a deleted-part line exists', async () => {
      const queue = makeQueue();
      const page = await render();
      await page.open(queue);

      await page.click(page.btn('#line-0-plus'));

      expect(page.updates[0]?.body.lines).toEqual([
        { partId: 'a', quantity: 3, completed: 2 },
        { partId: 'b', quantity: 2, completed: 0 },
      ]);
    });

    it('keeps unsaved goal and quantity edits when +1 succeeds', async () => {
      const page = await render();
      await page.open(makeQueue());
      await page.choose(page.select('#queue-goal'), 'fastest');
      await page.type(page.input('#line-0-quantity'), '4');

      await page.click(page.btn('#line-0-plus'));
      const saved = makeQueue({ version: 8 });
      saved.lines[0] = withLine(saved, 0, { completed: 2, pendingUnits: 1 });
      page.updates[0]?.reply.next(saved);
      page.updates[0]?.reply.complete();
      await page.settle();

      expect(page.select('#queue-goal')?.value).toBe('fastest');
      expect(page.input('#line-0-quantity')?.value).toBe('4');
      await page.click(page.button('Guardar cambios'));
      expect(page.updates[1]?.body).toEqual({
        version: 8,
        goal: 'fastest',
        lines: [
          { partId: 'a', quantity: 4, completed: 2 },
          { partId: 'b', quantity: 2, completed: 0 },
        ],
      });
    });

    it('explains a 400 on printerIds after switching from single to multi, without backend text', async () => {
      const page = await render();
      await page.open(makeQueue());
      const radios = Array.from(
        page.element.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      );
      await page.click(radios[1]);
      await page.click(page.element.querySelectorAll<HTMLInputElement>('#queue-printers input')[1]);
      await page.click(page.button('Guardar cambios'));

      page.updates[0]?.reply.error(problem(400, [{ path: 'printerIds', message: SENTINEL }]));
      await page.settle();

      expect(page.q('#queue-printers-error')?.textContent).toContain('coincidir con el modo');
      expect(page.q('#action-error')?.textContent).toContain('Revisá los datos marcados');
      expect(page.element.textContent).not.toContain(SENTINEL);
    });

    describe('deleting', () => {
      it('asks for confirmation in a dialog and focuses Cancelar first', async () => {
        const page = await render();
        await page.open(makeQueue());

        await page.click(page.button('Eliminar cola'));

        expect(page.q('dialog')).not.toBeNull();
        expect(document.activeElement?.textContent.trim()).toBe('Cancelar');
        expect(page.api.remove).not.toHaveBeenCalled();
      });

      it('returns focus to the trigger on cancel', async () => {
        const page = await render();
        await page.open(makeQueue());
        const trigger = page.button('Eliminar cola');
        await page.click(trigger);

        await page.click(page.button('Cancelar'));

        expect(page.q('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
      });

      it('deletes with the version, then shows the no-queue view with a notice', async () => {
        const page = await render();
        await page.open(makeQueue());
        await page.click(page.button('Eliminar cola'));

        await page.click(page.button('Eliminar'));

        expect(page.removes[0]?.version).toBe(7);
        expect(page.button('Eliminando…')?.disabled).toBe(true);
        page.removes[0]?.reply.next();
        page.removes[0]?.reply.complete();
        await page.settle();
        expect(page.text()).toContain('La cola se eliminó.');
        expect(page.api.get).toHaveBeenCalledTimes(2);
        expect(document.activeElement).toBe(page.q('#queue-title'));
      });

      it('closes the dialog and offers Recargar when the queue changed (409)', async () => {
        const page = await render();
        await page.open(makeQueue());
        await page.click(page.button('Eliminar cola'));
        await page.click(page.button('Eliminar'));

        page.removes[0]?.reply.error(problem(409));
        await page.settle();

        expect(page.q('dialog')).toBeNull();
        expect(page.q('#action-error')?.textContent).toContain('La cola cambió');
        expect(page.button('Recargar')).toBeDefined();
      });
    });
  });
});

describe('queue labels', () => {
  it.each([
    [0, '0 h 0 min'],
    [9000, '2 h 30 min'],
    [3600, '1 h 0 min'],
    [90, '0 h 2 min'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it.each([
    ['1', 1],
    ['1000', 1000],
    ['0', null],
    ['1001', null],
    ['2.5', null],
    ['', null],
    ['abc', null],
  ])('parses quantity "%s" as %s', (input, expected) => {
    expect(parseQuantity(input)).toBe(expected);
  });
});
