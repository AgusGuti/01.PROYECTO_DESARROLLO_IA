import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ProjectList, ProjectSummary } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError } from '../../core/api/api-error';
import { type ListProjectsQuery, ProjectsApi } from './projects-api';
import { ProjectsListPage } from './projects-list-page';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p1',
    name: 'Soportes para el taller',
    description: null,
    priority: 'normal',
    deadline: null,
    itemCount: 3,
    unitCount: 12,
    createdAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

function pageOf(items: ProjectSummary[], extra: Partial<ProjectList> = {}): ProjectList {
  return { items, page: 1, pageSize: 20, total: items.length, ...extra };
}

/** `count` projects named "Proyecto 1..count", ids unique. */
function manyProjects(count: number): ProjectSummary[] {
  return Array.from({ length: count }, (_, index) =>
    makeProject({ id: `id-${String(index + 1)}`, name: `Proyecto ${String(index + 1)}` }),
  );
}

async function render() {
  const pending: { query: ListProjectsQuery; reply: Subject<ProjectList> }[] = [];
  const removals: { id: string; reply: Subject<void> }[] = [];
  const api = {
    list: vi.fn((query: ListProjectsQuery) => {
      const reply = new Subject<ProjectList>();
      pending.push({ query, reply });
      return reply;
    }),
    remove: vi.fn((id: string) => {
      const reply = new Subject<void>();
      removals.push({ id, reply });
      return reply;
    }),
  };
  TestBed.configureTestingModule({
    imports: [ProjectsListPage],
    providers: [provideRouter([]), { provide: ProjectsApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(ProjectsListPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    pending,
    removals,
    text: () => element.textContent,
    row: () => element.querySelector('tbody tr')?.textContent.replace(/\s+/g, ' ') ?? '',
    live: () => element.querySelector('[aria-live="polite"]')?.textContent ?? '',
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    select: (id: string) => element.querySelector<HTMLSelectElement>(`#${id}`),
    async answer(index: number, list: ProjectList) {
      pending[index]?.reply.next(list);
      pending[index]?.reply.complete();
      await fixture.whenStable();
    },
    async fail(index: number, error: unknown) {
      pending[index]?.reply.error(error);
      await fixture.whenStable();
    },
    async choose(id: string, value: string) {
      const select = view.select(id);
      if (select) {
        select.value = value;
        select.dispatchEvent(new Event('change'));
      }
      await fixture.whenStable();
    },
    async click(target: HTMLElement | undefined) {
      target?.click();
      await fixture.whenStable();
    },
  };
  return view;
}

describe('ProjectsListPage', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    // Only the clock is faked, so the rest of the test environment keeps its real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has one h1 and shows a loading message while waiting', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Proyectos');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
      'Cargando proyectos',
    );
  });

  it('requests the first page of 20 sorted by creation date, newest first, with no filter', async () => {
    const page = await render();

    expect(page.pending).toHaveLength(1);
    expect(page.pending[0]?.query).toEqual({
      page: 1,
      pageSize: 20,
      priority: undefined,
      sort: 'createdAt',
      order: 'desc',
    });
    expect(page.select('sort-field')?.value).toBe('createdAt');
    expect(page.select('sort-order')?.value).toBe('desc');
  });

  it('shows each project with priority, deadline, lines and units', async () => {
    const page = await render();

    await page.answer(0, pageOf([makeProject({ priority: 'urgent', deadline: '2026-11-30' })]));

    expect(page.row()).toContain('Soportes para el taller');
    expect(page.row()).toContain('Urgente');
    expect(page.row()).toContain('30-11-2026');
    expect(page.row()).toContain('3 líneas · 12 unidades');
    expect(page.text()).not.toContain('urgent');
  });

  it('shows "Sin fecha" when the project has no deadline', async () => {
    const page = await render();

    await page.answer(0, pageOf([makeProject({ deadline: null })]));

    expect(page.row()).toContain('Sin fecha');
    expect(page.row()).not.toContain('Vencido');
  });

  it('marks a past deadline with the text Vencido and an icon hidden from screen readers', async () => {
    const page = await render();

    await page.answer(0, pageOf([makeProject({ deadline: '2026-10-14' })]));

    expect(page.row()).toContain('14-10-2026');
    expect(page.row()).toContain('Vencido');
    expect(page.element.querySelector('.overdue [aria-hidden="true"]')).not.toBeNull();
  });

  it('does not mark a deadline that is today or in the future as overdue', async () => {
    const page = await render();

    await page.answer(
      0,
      pageOf([
        makeProject({ id: 'a', deadline: '2026-10-15' }),
        makeProject({ id: 'b', deadline: '2026-10-16' }),
      ]),
    );

    expect(page.text()).not.toContain('Vencido');
  });

  it('invites the user to create the first project when there are none', async () => {
    const page = await render();

    await page.answer(0, pageOf([]));

    expect(page.text()).toContain('Todavía no tenés proyectos. Creá el primero.');
    const links = Array.from(page.element.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '/proyectos/nuevo',
    );
    expect(links.length).toBeGreaterThan(1);
    expect(page.element.querySelector('table')).toBeNull();
  });

  it('shows a different message when the filter matches nothing', async () => {
    const page = await render();
    await page.answer(0, pageOf([makeProject()]));

    await page.choose('priority-filter', 'low');
    await page.answer(1, pageOf([]));

    expect(page.text()).toContain('No hay proyectos con esa prioridad');
    expect(page.text()).not.toContain('Todavía no tenés proyectos');
  });

  it('shows a safe message and never the backend text when loading fails', async () => {
    const page = await render();

    await page.fail(
      0,
      new ApiError(500, 'internal', 'Ocurrió un error inesperado. Intentá de nuevo.', [], null, {
        detail: SENTINEL,
      }),
    );

    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'Ocurrió un error inesperado',
    );
    expect(page.element.innerHTML).not.toContain(SENTINEL);
  });

  it('asks again when Reintentar is pressed and shows the data', async () => {
    const page = await render();
    await page.fail(0, new ApiError(0, 'network_error', 'No se pudo conectar con el servidor.'));

    await page.click(page.button('Reintentar'));
    expect(page.pending).toHaveLength(2);
    await page.answer(1, pageOf([makeProject()]));

    expect(page.element.querySelector('[role="alert"]')).toBeNull();
    expect(page.text()).toContain('Soportes para el taller');
  });

  describe('filter and sort', () => {
    it('labels the priority filter and offers Todas plus the four priorities', async () => {
      const page = await render();

      const options = Array.from(page.select('priority-filter')?.options ?? []).map((o) =>
        o.textContent.trim(),
      );
      expect(page.element.querySelector('label[for="priority-filter"]')?.textContent).toBe(
        'Prioridad',
      );
      expect(options).toEqual(['Todas', 'Baja', 'Normal', 'Alta', 'Urgente']);
    });

    it('labels both sort controls and offers the four sortable fields', async () => {
      const page = await render();

      expect(page.element.querySelector('label[for="sort-field"]')?.textContent).toBe(
        'Ordenar por',
      );
      expect(page.element.querySelector('label[for="sort-order"]')?.textContent).toBe('Orden');
      expect(Array.from(page.select('sort-field')?.options ?? []).map((o) => o.value)).toEqual([
        'deadline',
        'priority',
        'name',
        'createdAt',
      ]);
      expect(Array.from(page.select('sort-order')?.options ?? []).map((o) => o.value)).toEqual([
        'asc',
        'desc',
      ]);
    });

    async function onPageTwo() {
      const page = await render();
      await page.answer(0, pageOf(manyProjects(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyProjects(20), { total: 45, page: 2 }));
      expect(page.pending[1]?.query.page).toBe(2);
      return page;
    }

    it('sends the chosen priority and goes back to page 1', async () => {
      const page = await onPageTwo();

      await page.choose('priority-filter', 'high');

      expect(page.pending[2]?.query).toMatchObject({ page: 1, priority: 'high' });
    });

    it('removes the priority filter when Todas is chosen again', async () => {
      const page = await render();
      await page.answer(0, pageOf([makeProject()]));
      await page.choose('priority-filter', 'high');
      await page.answer(1, pageOf([makeProject({ priority: 'high' })]));

      await page.choose('priority-filter', '');

      expect(page.pending[2]?.query.priority).toBeUndefined();
    });

    it('sends the chosen sort field and goes back to page 1', async () => {
      const page = await onPageTwo();

      await page.choose('sort-field', 'deadline');

      expect(page.pending[2]?.query).toMatchObject({ page: 1, sort: 'deadline', order: 'desc' });
    });

    it('sends the chosen order, keeps the sort field and goes back to page 1', async () => {
      const page = await onPageTwo();
      await page.choose('sort-field', 'priority');
      await page.answer(2, pageOf(manyProjects(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(3, pageOf(manyProjects(20), { total: 45, page: 2 }));

      await page.choose('sort-order', 'asc');

      expect(page.pending[4]?.query).toMatchObject({ page: 1, sort: 'priority', order: 'asc' });
    });

    it('ignores a sort value outside the allowlist', async () => {
      const page = await render();
      await page.answer(0, pageOf([makeProject()]));

      await page.choose('sort-field', 'password');

      expect(page.pending).toHaveLength(1);
    });
  });

  describe('pagination', () => {
    it('shows no pagination range when there are no projects', async () => {
      const page = await render();

      await page.answer(0, pageOf([]));

      expect(page.text()).not.toContain('Mostrando');
      expect(page.button('Siguiente')).toBeUndefined();
    });

    it('disables both buttons when everything fits in one page of exactly 20', async () => {
      const page = await render();

      await page.answer(0, pageOf(manyProjects(20), { total: 20 }));

      expect(page.text()).toContain('Mostrando 1–20 de 20');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });

    it('enables Siguiente on page 1 of 21 and shows the last single row on page 2', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyProjects(20), { total: 21 }));
      expect(page.text()).toContain('Mostrando 1–20 de 21');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(false);

      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyProjects(1), { total: 21, page: 2 }));

      expect(page.text()).toContain('Mostrando 21–21 de 21');
      expect(page.button('Anterior')?.disabled).toBe(false);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });
  });

  it('shows the latest answer even when an older request answers last', async () => {
    const page = await render();
    await page.answer(0, pageOf([makeProject({ id: 'a', name: 'Inicial' })]));
    await page.choose('priority-filter', 'low');
    await page.choose('priority-filter', 'urgent');

    await page.answer(2, pageOf([makeProject({ id: 'c', name: 'Reciente' })]));
    await page.answer(1, pageOf([makeProject({ id: 'b', name: 'Vieja' })]));

    expect(page.text()).toContain('Reciente');
    expect(page.text()).not.toContain('Vieja');
  });

  it('renders a hostile name as plain text', async () => {
    const page = await render();
    const hostile = '<img src=x onerror=alert(1)>';

    await page.answer(0, pageOf([makeProject({ name: hostile })]));

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.element.querySelector('tbody th')?.textContent).toBe(hostile);
  });

  it('gives each row an Editar link and an Eliminar button named after the project', async () => {
    const page = await render();

    await page.answer(0, pageOf([makeProject({ id: 'abc' })]));

    const row = page.element.querySelector('tbody tr');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe('/proyectos/abc/editar');
    expect(row?.querySelector('a')?.getAttribute('aria-label')).toBe(
      'Editar Soportes para el taller',
    );
    expect(row?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Eliminar Soportes para el taller',
    );
  });

  describe('deleting a project', () => {
    async function withOne() {
      const page = await render();
      await page.answer(0, pageOf([makeProject({ id: 'p1' })]));
      const trigger = page.button('Eliminar');
      await page.click(trigger);
      const dialog = () => page.element.querySelector('dialog');
      const dialogButton = (label: string) =>
        Array.from(dialog()?.querySelectorAll('button') ?? []).find(
          (b) => b.textContent.trim() === label,
        );
      return { page, trigger, dialog, dialogButton };
    }

    it('opens a confirmation naming the project without sending any request', async () => {
      const { page, dialog } = await withOne();

      expect(dialog()?.textContent).toContain('«Soportes para el taller»');
      expect(dialog()?.textContent).toContain('Se quita de las listas pero se conserva');
      expect(page.api.remove).not.toHaveBeenCalled();
    });

    it('starts with the focus on Cancelar', async () => {
      const { dialogButton } = await withOne();

      expect(document.activeElement).toBe(dialogButton('Cancelar'));
    });

    it('does nothing and returns the focus to the trigger when cancelled', async () => {
      const { page, trigger, dialog, dialogButton } = await withOne();

      await page.click(dialogButton('Cancelar'));

      expect(dialog()).toBeNull();
      expect(page.api.remove).not.toHaveBeenCalled();
      expect(page.api.list).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(trigger);
    });

    it('cancels on Escape without sending a request', async () => {
      const { page, trigger, dialog } = await withOne();

      dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
      await page.fixture.whenStable();

      expect(dialog()).toBeNull();
      expect(page.api.remove).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    });

    it('deletes after confirmation, reloads the list and announces the result', async () => {
      const { page, dialogButton } = await withOne();

      await page.click(dialogButton('Eliminar'));
      expect(page.api.remove).toHaveBeenCalledExactlyOnceWith('p1');
      page.removals[0]?.reply.next();
      page.removals[0]?.reply.complete();
      await page.fixture.whenStable();
      expect(page.pending).toHaveLength(2);
      await page.answer(1, pageOf([]));

      expect(page.live()).toContain('El proyecto se eliminó correctamente.');
      expect(page.text()).toContain('Todavía no tenés proyectos');
      expect(page.element.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(page.element.querySelector('h1'));
    });

    it('sends a single request even when Eliminar is pressed twice', async () => {
      const { page, dialogButton } = await withOne();
      const confirm = dialogButton('Eliminar');

      confirm?.click();
      confirm?.click();
      await page.fixture.whenStable();

      expect(page.api.remove).toHaveBeenCalledTimes(1);
    });

    it('shows a Spanish error without backend text when the deletion fails', async () => {
      const { page, dialogButton } = await withOne();

      await page.click(dialogButton('Eliminar'));
      page.removals[0]?.reply.error(
        new ApiError(500, 'internal', 'Ocurrió un error inesperado.', [], null, {
          detail: SENTINEL,
        }),
      );
      await page.fixture.whenStable();

      expect(page.live()).toContain('No se pudo eliminar el proyecto. Intentá de nuevo.');
      expect(page.text()).toContain('Soportes para el taller');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.pending).toHaveLength(1);
      expect(page.element.querySelector('dialog')).toBeNull();
    });

    it('reloads and says the project no longer exists on a 404', async () => {
      const { page, dialogButton } = await withOne();

      await page.click(dialogButton('Eliminar'));
      page.removals[0]?.reply.error(new ApiError(404, 'not_found', 'No existe.'));
      await page.fixture.whenStable();

      expect(page.live()).toContain('El proyecto ya no existe.');
      expect(page.pending).toHaveLength(2);
    });

    it('goes back one page when the last row of a later page is removed', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyProjects(20), { total: 21 }));
      await page.click(page.button('Siguiente'));
      await page.answer(
        1,
        pageOf([makeProject({ id: 'last', name: 'Ultimo' })], { total: 21, page: 2 }),
      );
      await page.click(page.button('Eliminar'));
      const confirm = Array.from(page.element.querySelectorAll('dialog button')).find(
        (b) => b.textContent.trim() === 'Eliminar',
      );

      await page.click(confirm as HTMLElement | undefined);
      page.removals[0]?.reply.next();
      page.removals[0]?.reply.complete();
      await page.fixture.whenStable();

      expect(page.pending[2]?.query.page).toBe(1);
    });
  });

  it('shows the message handed over by the form page after a save', async () => {
    const api = { list: () => new Subject<ProjectList>(), remove: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'proyectos', component: ProjectsListPage }]),
        { provide: ProjectsApi, useValue: api },
      ],
    });
    const harness = await RouterTestingHarness.create();

    await TestBed.inject(Router).navigateByUrl('/proyectos', { state: { notice: 'created' } });
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();

    const element = harness.fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'El proyecto se creó correctamente.',
    );
  });
});
