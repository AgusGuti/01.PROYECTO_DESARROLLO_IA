import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { Project } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { PartsPickerApi, type PickerCatalogue, type PickerPart } from './parts-picker-api';
import { ProjectFormPage } from './project-form-page';
import { ProjectsApi } from './projects-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';
const HOSTILE = '<img src=x onerror=alert(1)>';

const PARTS: PickerPart[] = [
  { id: 'a1', name: 'Soporte', material: 'PLA' },
  { id: 'b2', name: 'Tapa', material: 'PETG' },
  { id: 'c3', name: 'Base', material: 'PA_CF' },
];

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Soportes del taller',
    description: 'Para el taller',
    priority: 'high',
    deadline: '2026-11-30',
    items: [{ partId: 'a1', quantity: 2, part: { name: 'Soporte', material: 'PLA' } }],
    version: 3,
    createdAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

async function render(options: { editing?: boolean; parts?: PickerPart[] } = {}) {
  const gets: Subject<Project>[] = [];
  const saves: Subject<Project>[] = [];
  const catalogues: Subject<PickerCatalogue>[] = [];
  const api = {
    get: vi.fn((_id: string) => {
      const reply = new Subject<Project>();
      gets.push(reply);
      return reply;
    }),
    create: vi.fn((_body: unknown) => {
      const reply = new Subject<Project>();
      saves.push(reply);
      return reply;
    }),
    update: vi.fn((_id: string, _body: unknown) => {
      const reply = new Subject<Project>();
      saves.push(reply);
      return reply;
    }),
  };
  const picker = {
    loadAll: vi.fn(() => {
      const reply = new Subject<PickerCatalogue>();
      catalogues.push(reply);
      return reply;
    }),
  } satisfies Pick<PartsPickerApi, 'loadAll'>;
  const params = options.editing === true ? { id: 'p1' } : {};
  TestBed.configureTestingModule({
    imports: [ProjectFormPage],
    providers: [
      provideRouter([]),
      { provide: ProjectsApi, useValue: api },
      { provide: PartsPickerApi, useValue: picker },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(ProjectFormPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    picker,
    navigate,
    gets,
    saves,
    catalogues,
    text: () => element.textContent,
    byId: (id: string) => element.querySelector<HTMLInputElement>(`#${id}`),
    selectById: (id: string) => element.querySelector<HTMLSelectElement>(`#${id}`),
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    live: () => element.querySelector('[aria-live="polite"]')?.textContent.trim() ?? '',
    errorOf: (id: string) => element.querySelector(`#${id}`)?.textContent.trim() ?? null,
    lineNames: () =>
      Array.from(element.querySelectorAll('tbody th')).map((th) => th.textContent.trim()),
    partOptions: () =>
      Array.from(view.selectById('field-part')?.options ?? [])
        .map((o) => o.textContent.trim())
        .filter((text) => text !== 'Elegí una pieza'),
    async type(id: string, value: string) {
      const input = view.byId(id);
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      await fixture.whenStable();
    },
    async choose(id: string, value: string) {
      const select = view.selectById(id);
      if (select) {
        select.value = value;
        select.dispatchEvent(new Event('change'));
      }
      await fixture.whenStable();
    },
    async submit() {
      view.button('Guardar')?.click();
      await fixture.whenStable();
    },
    async click(target: HTMLElement | null | undefined) {
      target?.click();
      await fixture.whenStable();
    },
    async answerPicker(parts: PickerPart[] = options.parts ?? PARTS, truncated = false) {
      catalogues[catalogues.length - 1]?.next({ parts, truncated });
      await fixture.whenStable();
    },
    async loadProject(project: Project) {
      gets[gets.length - 1]?.next(project);
      await fixture.whenStable();
    },
    async addPart(id: string, quantity?: string) {
      await view.choose('field-part', id);
      if (quantity !== undefined) await view.type('field-add-quantity', quantity);
      await view.click(view.button('Agregar'));
    },
    async rejectSave(error: unknown) {
      saves[saves.length - 1]?.error(error);
      await fixture.whenStable();
    },
  };
  return view;
}

async function renderCreating(parts: PickerPart[] = PARTS) {
  const view = await render();
  await view.answerPicker(parts);
  return view;
}

async function renderEditing(project: Project = makeProject()) {
  const view = await render({ editing: true });
  await view.answerPicker();
  await view.loadProject(project);
  return view;
}

describe('ProjectFormPage (create)', () => {
  it('has one h1 and a label for every control', async () => {
    const page = await renderCreating();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Nuevo proyecto');
    const controls = Array.from(page.element.querySelectorAll('input, select'));
    expect(controls).toHaveLength(6);
    for (const control of controls) {
      const labelled = control as HTMLInputElement;
      expect(labelled.labels?.length, `control ${labelled.id} has no label`).toBeGreaterThan(0);
    }
  });

  it('starts with priority Normal, no deadline and a hint that a past date is allowed', async () => {
    const page = await renderCreating();

    expect(page.selectById('field-priority')?.value).toBe('normal');
    expect(page.byId('field-deadline')?.value).toBe('');
    expect(page.byId('field-deadline')?.getAttribute('type')).toBe('text');
    expect(page.byId('field-deadline')?.getAttribute('placeholder')).toBe('DD-MM-AAAA');
    expect(page.byId('field-deadline')?.getAttribute('aria-describedby')).toBe('deadline-hint');
    expect(page.errorOf('deadline-hint')).toBe('Formato DD-MM-AAAA. Puede ser una fecha pasada.');
    expect(
      Array.from(page.selectById('field-priority')?.options ?? []).map((o) => o.text.trim()),
    ).toEqual(['Baja', 'Normal', 'Alta', 'Urgente']);
  });

  describe('validation', () => {
    it('blocks an empty name, explains it and moves the focus there', async () => {
      const page = await renderCreating();

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('error-name')).toBe('Ingresá el nombre.');
      expect(page.byId('field-name')?.getAttribute('aria-invalid')).toBe('true');
      expect(page.byId('field-name')?.getAttribute('aria-describedby')).toBe('error-name');
      expect(document.activeElement).toBe(page.byId('field-name'));
    });

    it('rejects a name longer than 100 characters and accepts exactly 100', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'a'.repeat(101));
      await page.submit();
      expect(page.errorOf('error-name')).toContain('hasta 100 caracteres');

      await page.type('field-name', 'a'.repeat(100));
      await page.submit();

      expect(page.errorOf('error-name')).toBeNull();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a description longer than 1000 characters', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Proyecto');
      await page.type('field-description', 'd'.repeat(1001));

      await page.submit();

      expect(page.errorOf('error-description')).toContain('hasta 1000 caracteres');
      expect(page.api.create).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(page.byId('field-description'));
    });

    it.each(['31-12-1999', '01-01-2100', '2026-11-30', '30-02-2026'])(
      'rejects the deadline %s because the API only accepts 2000 to 2099',
      async (value) => {
        const page = await renderCreating();
        await page.type('field-name', 'Proyecto');
        await page.type('field-deadline', value);

        await page.submit();

        expect(page.errorOf('error-deadline')).toContain('2000');
        expect(page.api.create).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(page.byId('field-deadline'));
      },
    );

    it.each([
      ['01-01-2000', '2000-01-01'],
      ['31-12-2099', '2099-12-31'],
      ['29-02-2020', '2020-02-29'],
    ])('accepts the deadline %s', async (value, iso) => {
      const page = await renderCreating();
      await page.type('field-name', 'Proyecto');
      await page.type('field-deadline', value);

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(expect.objectContaining({ deadline: iso }));
    });
  });

  describe('saving', () => {
    it('sends only the name and the default priority when the optional fields are empty', async () => {
      const page = await renderCreating();
      await page.type('field-name', '  Soportes  ');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledExactlyOnceWith({
        name: 'Soportes',
        priority: 'normal',
      });
    });

    it('sends the description, priority, deadline and items when they were filled', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.type('field-description', 'Para el taller');
      await page.choose('field-priority', 'urgent');
      await page.type('field-deadline', '30-11-2026');
      await page.addPart('a1', '4');
      await page.addPart('b2');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledExactlyOnceWith({
        name: 'Soportes',
        description: 'Para el taller',
        priority: 'urgent',
        deadline: '2026-11-30',
        items: [
          { partId: 'a1', quantity: 4 },
          { partId: 'b2', quantity: 1 },
        ],
      });
    });

    it('goes to the list with a created notice on success', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.submit();

      page.saves[0]?.next(makeProject());
      await page.fixture.whenStable();

      expect(page.navigate).toHaveBeenCalledWith(['/proyectos'], { state: { notice: 'created' } });
    });

    it('sends one request and disables Guardar while the first one is in flight', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');

      page.button('Guardar')?.click();
      page.element.querySelector('form')?.dispatchEvent(new Event('submit'));
      await page.fixture.whenStable();

      expect(page.api.create).toHaveBeenCalledTimes(1);
      expect(page.button('Guardando…')?.disabled).toBe(true);
    });

    it('shows a safe error, keeps the data and does not retry on its own after a 503', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.submit();

      await page.rejectSave(problem(503));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.byId('field-name')?.value).toBe('Soportes');
      expect(page.api.create).toHaveBeenCalledTimes(1);
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('shows a generic message for an error that is not an ApiError', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.submit();

      await page.rejectSave(new Error(SENTINEL));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Ocurrió un error inesperado',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });
  });

  describe('server validation errors', () => {
    async function readyToFail() {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.addPart('a1');
      await page.addPart('b2');
      await page.submit();
      return page;
    }

    it('puts a name issue next to the name and focuses it', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(400, [{ path: 'name', message: SENTINEL }]));

      expect(page.errorOf('error-name')).toBe('El nombre no es válido.');
      expect(document.activeElement).toBe(page.byId('field-name'));
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('puts a deadline issue next to the deadline', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(400, [{ path: 'deadline', message: SENTINEL }]));

      expect(page.errorOf('error-deadline')).toBe('La fecha límite no es válida.');
      expect(page.byId('field-deadline')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('shows a general items issue in the items section', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(400, [{ path: 'items', message: SENTINEL }]));

      expect(page.errorOf('error-items')).toBe('Revisá las piezas del proyecto.');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('puts a quantity issue on the line it names and focuses that quantity', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(400, [{ path: 'items.1.quantity', message: SENTINEL }]));

      expect(page.errorOf('line-error-1')).toContain('cantidad entera');
      expect(page.errorOf('line-error-0')).toBeNull();
      expect(page.byId('line-qty-1')?.getAttribute('aria-describedby')).toBe('line-error-1');
      expect(document.activeElement).toBe(page.byId('line-qty-1'));
    });

    it('puts a part issue on the line it names', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(400, [{ path: 'items.0.partId', message: SENTINEL }]));

      expect(page.errorOf('line-error-0')).toContain('ya no existe o está repetida');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('clears a line issue as soon as the user edits that quantity', async () => {
      const page = await readyToFail();
      await page.rejectSave(problem(400, [{ path: 'items.0.partId', message: 'x' }]));

      await page.type('line-qty-0', '3');

      expect(page.errorOf('line-error-0')).toBeNull();
    });

    it('shows the safe message when a 400 names a path we do not know', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(400, [{ path: 'secret', message: SENTINEL }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('ignores a line issue whose index does not exist and falls back to the safe message', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(400, [{ path: 'items.9.quantity', message: 'x' }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
    });

    it('shows the generic message for a 413', async () => {
      const page = await readyToFail();

      await page.rejectSave(problem(413));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });
  });

  describe('items editor', () => {
    it('lists "Nombre · Material" for every part and starts with an empty list', async () => {
      const page = await renderCreating();

      expect(page.partOptions()).toEqual([
        'Soporte · PLA',
        'Tapa · PETG',
        'Base · Nailon con fibra de carbono (PA-CF)',
      ]);
      expect(page.text()).toContain('Todavía no agregaste piezas.');
      expect(page.element.querySelector('table')).toBeNull();
    });

    it('adds a line, announces it, resets the controls and returns the focus to the select', async () => {
      const page = await renderCreating();

      await page.addPart('a1', '5');

      expect(page.lineNames()).toEqual(['Soporte']);
      expect(page.byId('line-qty-0')?.value).toBe('5');
      expect(page.live()).toBe('Pieza agregada');
      expect(page.selectById('field-part')?.value).toBe('');
      expect(page.byId('field-add-quantity')?.value).toBe('1');
      expect(document.activeElement).toBe(page.selectById('field-part'));
    });

    it('stops offering a part once it was added', async () => {
      const page = await renderCreating();

      await page.addPart('b2');

      expect(page.partOptions()).toEqual([
        'Soporte · PLA',
        'Base · Nailon con fibra de carbono (PA-CF)',
      ]);
    });

    it('asks for a part when Agregar is pressed with none chosen', async () => {
      const page = await renderCreating();

      await page.click(page.button('Agregar'));

      expect(page.errorOf('error-add')).toBe('Elegí una pieza para agregar.');
      expect(page.lineNames()).toEqual([]);
      expect(document.activeElement).toBe(page.selectById('field-part'));
    });

    it.each(['0', '1001', '1.5', ''])(
      'refuses to add a line with the quantity "%s"',
      async (quantity) => {
        const page = await renderCreating();
        await page.choose('field-part', 'a1');
        await page.type('field-add-quantity', quantity);

        await page.click(page.button('Agregar'));

        expect(page.errorOf('error-add')).toContain('cantidad entera entre 1 y 1000');
        expect(page.lineNames()).toEqual([]);
        expect(document.activeElement).toBe(page.byId('field-add-quantity'));
      },
    );

    it('accepts the boundary quantities 1 and 1000', async () => {
      const page = await renderCreating();

      await page.addPart('a1', '1000');
      await page.addPart('b2', '1');

      expect(page.byId('line-qty-0')?.value).toBe('1000');
      expect(page.byId('line-qty-1')?.value).toBe('1');
    });

    it('adds the line with Enter in the quantity field without submitting the form', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.choose('field-part', 'a1');

      page
        .byId('field-add-quantity')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      await page.fixture.whenStable();

      expect(page.lineNames()).toEqual(['Soporte']);
      expect(page.api.create).not.toHaveBeenCalled();
    });

    it('removes a line with a button named after the part, announces it and focuses the select', async () => {
      const page = await renderCreating();
      await page.addPart('a1');
      await page.addPart('b2');
      expect(page.byId('line-remove-0')?.getAttribute('aria-label')).toBe('Quitar «Soporte»');

      await page.click(page.byId('line-remove-0'));

      expect(page.lineNames()).toEqual(['Tapa']);
      expect(page.live()).toBe('Pieza quitada');
      expect(page.partOptions()).toContain('Soporte · PLA');
      expect(document.activeElement).toBe(page.selectById('field-part'));
    });

    it('blocks saving and focuses the quantity when a line has an invalid quantity', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.addPart('a1');
      await page.addPart('b2');
      await page.type('line-qty-1', '0');

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('line-error-1')).toContain('cantidad entera');
      expect(document.activeElement).toBe(page.byId('line-qty-1'));
    });

    it('sends an edited quantity of a line', async () => {
      const page = await renderCreating();
      await page.type('field-name', 'Soportes');
      await page.addPart('a1');
      await page.type('line-qty-0', '7');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(
        expect.objectContaining({ items: [{ partId: 'a1', quantity: 7 }] }),
      );
    });

    it('allows at most 100 lines, disables Agregar and says so', async () => {
      const many = Array.from({ length: 101 }, (_, index) => ({
        id: `x${String(index + 1)}`,
        name: `Pieza ${String(index + 1)}`,
        material: 'PLA' as const,
      }));
      const page = await renderCreating(many);

      for (let index = 1; index <= 99; index += 1) await page.addPart(`x${String(index)}`);
      expect(page.button('Agregar')?.disabled).toBe(false);
      expect(page.text()).not.toContain('máximo de 100');
      await page.addPart('x100');

      expect(page.lineNames()).toHaveLength(100);
      expect(page.button('Agregar')?.disabled).toBe(true);
      expect(page.text()).toContain('Llegaste al máximo de 100 piezas por proyecto.');
      await page.choose('field-part', 'x101');
      page
        .byId('field-add-quantity')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      await page.fixture.whenStable();
      expect(page.lineNames()).toHaveLength(100);
    });

    it('renders hostile part names as text in the options and in the lines', async () => {
      const page = await renderCreating([{ id: 'h1', name: HOSTILE, material: 'PLA' }]);
      await page.addPart('h1');

      expect(page.element.querySelector('img')).toBeNull();
      expect(page.lineNames()).toEqual([HOSTILE]);
    });
  });

  describe('part picker states', () => {
    it('shows a loading message while the catalogue is read', async () => {
      const page = await render();

      expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
        'Cargando las piezas disponibles',
      );
    });

    it('shows a safe error with Reintentar and asks again when it is pressed', async () => {
      const page = await render();
      page.catalogues[0]?.error(problem(503));
      await page.fixture.whenStable();
      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);

      await page.click(page.button('Reintentar'));
      await page.answerPicker();

      expect(page.picker.loadAll).toHaveBeenCalledTimes(2);
      expect(page.partOptions()).toHaveLength(3);
    });

    it('points to the parts feature when there are no parts at all', async () => {
      const page = await renderCreating([]);

      expect(page.text()).toContain('Todavía no hay piezas cargadas.');
      const link = Array.from(page.element.querySelectorAll('a')).find(
        (a) => a.getAttribute('href') === '/piezas/nueva',
      );
      expect(link?.textContent).toContain('Creá una pieza');
    });

    it('warns that the catalogue is too long for the picker when it was cut', async () => {
      const page = await render();

      await page.answerPicker(PARTS, true);

      expect(page.text()).toContain('demasiadas piezas para este selector');
    });

    it('shows no such warning when the whole catalogue was read', async () => {
      const page = await renderCreating();

      expect(page.text()).not.toContain('demasiadas piezas');
    });
  });

  it('can be completed with the keyboard alone using only native controls', async () => {
    const page = await renderCreating();
    const focusable = Array.from(
      page.element.querySelectorAll<HTMLElement>('input, select, button, a[href]'),
    );
    expect(focusable.every((el) => !el.hasAttribute('tabindex') || el.tabIndex <= 0)).toBe(true);

    await page.type('field-name', 'Soportes');
    await page.choose('field-part', 'a1');
    page
      .byId('field-add-quantity')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await page.fixture.whenStable();
    expect(document.activeElement).toBe(page.selectById('field-part'));
    page.element.querySelector('form')?.dispatchEvent(new Event('submit'));
    await page.fixture.whenStable();

    expect(page.api.create).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ partId: 'a1', quantity: 1 }] }),
    );
  });
});

describe('ProjectFormPage (edit)', () => {
  it('shows a loading message, then the project data in the controls', async () => {
    const page = await render({ editing: true });
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
      'Cargando el proyecto',
    );
    expect(page.api.get).toHaveBeenCalledWith('p1');

    await page.answerPicker();
    await page.loadProject(makeProject());

    expect(page.element.querySelector('h1')?.textContent).toBe('Editar proyecto');
    expect(page.byId('field-name')?.value).toBe('Soportes del taller');
    expect(page.byId('field-description')?.value).toBe('Para el taller');
    expect(page.selectById('field-priority')?.value).toBe('high');
    expect(page.byId('field-deadline')?.value).toBe('30-11-2026');
    expect(page.lineNames()).toEqual(['Soporte']);
    expect(page.byId('line-qty-0')?.value).toBe('2');
  });

  it('says the project no longer exists when loading answers 404', async () => {
    const page = await render({ editing: true });

    page.gets[0]?.error(problem(404));
    await page.fixture.whenStable();

    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'El proyecto ya no existe.',
    );
    expect(page.element.querySelector('form')).toBeNull();
  });

  it('shows a safe error with Reintentar when loading fails and loads again', async () => {
    const page = await render({ editing: true });
    page.gets[0]?.error(problem(500));
    await page.fixture.whenStable();
    expect(page.element.innerHTML).not.toContain(SENTINEL);

    await page.click(page.button('Reintentar'));

    expect(page.api.get).toHaveBeenCalledTimes(2);
  });

  it('sends nothing and returns to the list when nothing changed', async () => {
    const page = await renderEditing();

    await page.submit();

    expect(page.api.update).not.toHaveBeenCalled();
    expect(page.navigate).toHaveBeenCalledWith(['/proyectos']);
  });

  it('sends only the changed field plus the version', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro nombre');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledExactlyOnceWith('p1', {
      version: 3,
      name: 'Otro nombre',
    });
  });

  it('sends the priority and a new deadline when those changed', async () => {
    const page = await renderEditing();
    await page.choose('field-priority', 'low');
    await page.type('field-deadline', '24-12-2026');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', {
      version: 3,
      priority: 'low',
      deadline: '2026-12-24',
    });
  });

  it('sends null to clear the description and the deadline', async () => {
    const page = await renderEditing();
    await page.type('field-description', '   ');
    await page.type('field-deadline', '');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', {
      version: 3,
      description: null,
      deadline: null,
    });
  });

  it('sends the whole items list when a quantity changed', async () => {
    const page = await renderEditing();
    await page.addPart('b2', '3');
    await page.type('line-qty-0', '9');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', {
      version: 3,
      items: [
        { partId: 'a1', quantity: 9 },
        { partId: 'b2', quantity: 3 },
      ],
    });
  });

  it('sends an empty items list when the last line was removed', async () => {
    const page = await renderEditing();
    await page.click(page.byId('line-remove-0'));

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', { version: 3, items: [] });
  });

  it('does not send items when a line was added and removed again', async () => {
    const page = await renderEditing();
    await page.addPart('b2');
    await page.click(page.byId('line-remove-1'));

    await page.submit();

    expect(page.api.update).not.toHaveBeenCalled();
  });

  it('goes to the list with an updated notice on success', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro');
    await page.submit();

    page.saves[0]?.next(makeProject({ version: 4 }));
    await page.fixture.whenStable();

    expect(page.navigate).toHaveBeenCalledWith(['/proyectos'], { state: { notice: 'updated' } });
  });

  describe('a line whose part was deleted', () => {
    const withDeleted = () =>
      makeProject({
        items: [
          { partId: 'a1', quantity: 2, part: { name: 'Soporte', material: 'PLA' } },
          { partId: 'zz', quantity: 1, part: null },
        ],
      });

    it('shows "Pieza eliminada" and explains that it has to be removed', async () => {
      const page = await renderEditing(withDeleted());

      expect(page.lineNames()).toEqual(['Soporte', 'Pieza eliminada']);
      expect(page.text()).toContain('Hay piezas eliminadas. Quitalas para poder guardar.');
      expect(page.byId('line-remove-1')?.getAttribute('aria-label')).toBe(
        'Quitar «Pieza eliminada»',
      );
    });

    it('blocks saving, sends nothing and focuses the button that removes it', async () => {
      const page = await renderEditing(withDeleted());
      await page.type('field-name', 'Otro nombre');

      await page.submit();

      expect(page.api.update).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(page.byId('line-remove-1'));
    });

    it('lets the user save once the deleted line is removed', async () => {
      const page = await renderEditing(withDeleted());
      await page.click(page.byId('line-remove-1'));

      await page.submit();

      expect(page.api.update).toHaveBeenCalledWith('p1', {
        version: 3,
        items: [{ partId: 'a1', quantity: 2 }],
      });
    });
  });

  describe('conflicts and missing project', () => {
    it('explains a version conflict and offers Recargar', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'version', message: SENTINEL }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Alguien más modificó este proyecto. Recargá para ver la versión actual.',
      );
      expect(page.button('Recargar')).toBeDefined();
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('reloads the project with the new version and drops the stale edits', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.addPart('b2');
      await page.submit();
      await page.rejectSave(problem(409, [{ path: 'version', message: 'x' }]));

      await page.click(page.button('Recargar'));
      expect(page.api.get).toHaveBeenCalledTimes(2);
      await page.loadProject(makeProject({ name: 'Nombre del otro', version: 4, items: [] }));

      expect(page.element.querySelector('[role="alert"]')).toBeNull();
      expect(page.byId('field-name')?.value).toBe('Nombre del otro');
      expect(page.lineNames()).toEqual([]);
      await page.type('field-name', 'Mi cambio de nuevo');
      await page.submit();
      expect(page.api.update).toHaveBeenLastCalledWith('p1', {
        version: 4,
        name: 'Mi cambio de nuevo',
      });
    });

    it('shows a different message for a conflict that is not about the version', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'other', message: 'x' }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'conflicto con otros datos',
      );
      expect(page.button('Recargar')).toBeUndefined();
    });

    it('goes to the list with a "gone" notice when saving answers 404', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.submit();

      await page.rejectSave(problem(404));

      expect(page.navigate).toHaveBeenCalledWith(['/proyectos'], { state: { notice: 'gone' } });
    });
  });
});
