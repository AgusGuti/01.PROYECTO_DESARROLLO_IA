import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { Printer } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { PrinterFormPage } from './printer-form-page';
import { PrintersApi } from './printers-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

function makePrinter(overrides: Partial<Printer> = {}): Printer {
  return {
    id: 'p1',
    name: 'Ender 3 Pro',
    buildVolume: { x: 220, y: 220, z: 250 },
    nozzle: { diameterMm: 0.2, material: 'brass' },
    compatibleMaterials: ['PLA', 'PETG'],
    typicalSpeedMmS: 60,
    powerWatts: 120,
    status: 'available',
    version: 3,
    archivedAt: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

async function render(options: { editing?: boolean } = {}) {
  const gets: Subject<Printer>[] = [];
  const saves: Subject<unknown>[] = [];
  const api = {
    get: vi.fn((_id: string) => {
      const reply = new Subject<Printer>();
      gets.push(reply);
      return reply;
    }),
    create: vi.fn((_body: unknown) => {
      const reply = new Subject<unknown>();
      saves.push(reply);
      return reply;
    }),
    update: vi.fn((_id: string, _body: unknown) => {
      const reply = new Subject<unknown>();
      saves.push(reply);
      return reply;
    }),
  };
  const params = options.editing === true ? { id: 'p1' } : {};
  TestBed.configureTestingModule({
    imports: [PrinterFormPage],
    providers: [
      provideRouter([]),
      { provide: PrintersApi, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PrinterFormPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    navigate,
    gets,
    saves,
    text: () => element.textContent,
    byId: (id: string) => element.querySelector<HTMLInputElement>(`#${id}`),
    selectById: (id: string) => element.querySelector<HTMLSelectElement>(`#${id}`),
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    async type(id: string, value: string) {
      const input = view.byId(id);
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      await fixture.whenStable();
    },
    async pick(id: string, optionText: string) {
      const select = view.selectById(id);
      if (select) {
        select.selectedIndex = Array.from(select.options).findIndex(
          (o) => o.textContent.trim() === optionText,
        );
        select.dispatchEvent(new Event('change'));
      }
      await fixture.whenStable();
    },
    async check(material: string, checked = true) {
      const box = view.byId(`material-${material}`);
      if (box) {
        box.checked = checked;
        box.dispatchEvent(new Event('change'));
      }
      await fixture.whenStable();
    },
    async submit() {
      view.button('Guardar')?.click();
      await fixture.whenStable();
    },
    async fillValid() {
      await view.type('field-name', 'Prusa MK4');
      await view.type('field-x', '250');
      await view.type('field-y', '210');
      await view.type('field-z', '220');
      await view.check('PLA');
    },
    async loadPrinter(printer: Printer) {
      gets[gets.length - 1]?.next(printer);
      await fixture.whenStable();
    },
    errorOf: (id: string) => element.querySelector(`#${id}`)?.textContent.trim() ?? null,
    async rejectSave(error: unknown) {
      saves[saves.length - 1]?.error(error);
      await fixture.whenStable();
    },
  };
  return view;
}

async function renderEditing(printer: Printer = makePrinter()) {
  const view = await render({ editing: true });
  await view.loadPrinter(printer);
  return view;
}

describe('PrinterFormPage (create)', () => {
  it('has one h1 and a label for every control', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Nueva impresora');
    const controls = Array.from(page.element.querySelectorAll('input, select'));
    expect(controls.length).toBe(3 + 1 + 1 + 1 + 14 + 1 + 1 + 1);
    for (const control of controls) {
      const labelled = control as HTMLInputElement;
      expect(labelled.labels?.length, `control ${labelled.id} has no label`).toBeGreaterThan(0);
    }
    const labels = Array.from(page.element.querySelectorAll('label')).map((l) =>
      l.textContent.trim(),
    );
    expect(labels).toEqual(
      expect.arrayContaining(['Nombre', 'Ancho (mm)', 'Fondo (mm)', 'Alto (mm)', 'Estado']),
    );
    expect(page.element.querySelector('fieldset legend')?.textContent).toBe('Volumen de impresión');
  });

  it('offers the six nozzle diameters and defaults the status to Disponible', async () => {
    const page = await render();

    const diameters = Array.from(page.selectById('field-diameter')?.options ?? []).map((o) =>
      o.textContent.trim(),
    );
    expect(diameters).toEqual(['0,2 mm', '0,25 mm', '0,4 mm', '0,6 mm', '0,8 mm', '1 mm']);
    const status = page.selectById('field-status');
    expect(status?.selectedOptions[0]?.textContent.trim()).toBe('Disponible');
  });

  it('submits through a real submit button inside the form, so Enter works', async () => {
    const page = await render();
    await page.fillValid();

    const submit = page.element.querySelector<HTMLButtonElement>('form button[type="submit"]');
    page.element.querySelector('form')?.dispatchEvent(new Event('submit'));
    await page.fixture.whenStable();

    expect(submit).not.toBeNull();
    expect(page.api.create).toHaveBeenCalledTimes(1);
  });

  describe('client validation', () => {
    it('blocks an empty form, links each error to its field and focuses the first one', async () => {
      const page = await render();

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(page.byId('field-name'));
      const name = page.byId('field-name');
      expect(name?.getAttribute('aria-invalid')).toBe('true');
      expect(name?.getAttribute('aria-describedby')).toBe('name-error');
      expect(page.errorOf('name-error')).toBe('Ingresá el nombre de la impresora.');
      expect(page.errorOf('x-error')).toBe('Ingresá un número entero entre 1 y 2000.');
      expect(page.errorOf('materials-error')).toBe('Elegí al menos un material.');
    });

    it('rejects a name made only of spaces', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-name', '    ');

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('name-error')).toBe('Ingresá el nombre de la impresora.');
    });

    it('rejects a name longer than 100 characters but accepts exactly 100', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-name', 'a'.repeat(101));

      await page.submit();
      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('name-error')).toBe('El nombre puede tener hasta 100 caracteres.');

      await page.type('field-name', 'a'.repeat(100));
      await page.submit();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it.each(['0', '2001', '1.5'])('rejects a volume of %s', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-y', value);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('y-error')).toBe('Ingresá un número entero entre 1 y 2000.');
      expect(document.activeElement).toBe(page.byId('field-y'));
    });

    it.each(['1', '2000'])('accepts the boundary volume %s', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-z', value);

      await page.submit();

      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('requires at least one material and focuses the materials', async () => {
      const page = await render();
      await page.fillValid();
      await page.check('PLA', false);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('materials-error')).toBe('Elegí al menos un material.');
      expect(
        page.element.querySelector('fieldset[aria-describedby~="materials-error"]'),
      ).not.toBeNull();
      expect(document.activeElement).toBe(page.byId('material-PLA'));
    });

    it('rejects a typical speed of 1001 and treats a blank speed as unset', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-speed', '1001');

      await page.submit();
      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('speed-error')).toContain('entre 1 y 1000');

      await page.type('field-speed', '');
      await page.submit();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('labels the average power with its hint and accepts it empty', async () => {
      const page = await render();
      await page.fillValid();

      await page.submit();

      expect(page.element.querySelector('label[for="field-power"]')?.textContent).toContain(
        'Potencia promedio (W)',
      );
      expect(page.byId('field-power')?.getAttribute('aria-describedby')).toContain('power-hint');
      expect(page.errorOf('power-hint')).toBe(
        'Consumo medio mientras imprime, no el máximo de la fuente',
      );
      expect(page.api.create).toHaveBeenCalledExactlyOnceWith(
        expect.not.objectContaining({ powerWatts: expect.anything() as unknown }),
      );
    });

    it.each(['0', '5001', '1.5'])('rejects an average power of %s', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-power', value);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('power-error')).toContain('entre 1 y 5000');
      expect(page.byId('field-power')?.getAttribute('aria-invalid')).toBe('true');
    });

    it.each(['1', '5000'])('sends an average power of %s watts', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-power', value);

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(
        expect.objectContaining({ powerWatts: Number(value) }),
      );
    });
  });

  describe('reinforced materials', () => {
    it.each(['Latón', 'Acero inoxidable'])(
      'disables the fibre materials for a %s nozzle and explains why',
      async (nozzle) => {
        const page = await render();

        await page.pick('field-nozzle-material', nozzle);

        for (const id of ['PLA_CF', 'PETG_CF', 'PA_CF', 'PA_GF']) {
          expect(page.byId(`material-${id}`)?.disabled, id).toBe(true);
        }
        expect(page.byId('material-PLA')?.disabled).toBe(false);
        expect(page.byId('material-PA')?.disabled).toBe(false);
        expect(page.text()).toContain('necesitan una boquilla de acero endurecido');
      },
    );

    it('enables the fibre materials for a hardened steel nozzle', async () => {
      const page = await render();

      await page.pick('field-nozzle-material', 'Acero endurecido');

      for (const id of ['PLA_CF', 'PETG_CF', 'PA_CF', 'PA_GF']) {
        expect(page.byId(`material-${id}`)?.disabled, id).toBe(false);
      }
      expect(page.element.querySelector('#materials-hint')).toBeNull();
    });

    it('deselects fibre materials and says so when the nozzle stops being hardened steel', async () => {
      const page = await render();
      await page.pick('field-nozzle-material', 'Acero endurecido');
      await page.check('PA_CF');
      await page.check('PLA');
      expect(page.byId('material-PA_CF')?.checked).toBe(true);

      await page.pick('field-nozzle-material', 'Latón');

      expect(page.byId('material-PA_CF')?.checked).toBe(false);
      expect(page.byId('material-PLA')?.checked).toBe(true);
      expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
        'Se quitaron los materiales con fibra porque la boquilla no es de acero endurecido.',
      );
    });

    it('does not show the removal message when no fibre material was selected', async () => {
      const page = await render();
      await page.check('PLA');

      await page.pick('field-nozzle-material', 'Acero inoxidable');

      expect(page.text()).not.toContain('Se quitaron los materiales con fibra');
    });
  });

  describe('saving', () => {
    it('creates the printer with a body that has no version and omits an unset speed', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-name', '  Prusa MK4  ');
      await page.pick('field-diameter', '0,6 mm');
      await page.pick('field-status', 'En mantenimiento');
      await page.check('PETG');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledExactlyOnceWith({
        name: 'Prusa MK4',
        buildVolume: { x: 250, y: 210, z: 220 },
        nozzle: { diameterMm: 0.6, material: 'brass' },
        compatibleMaterials: ['PLA', 'PETG'],
        status: 'maintenance',
      });
    });

    it('sends the typical speed when one is given', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-speed', '80');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(
        expect.objectContaining({ typicalSpeedMmS: 80 }),
      );
    });

    it('goes to the list with a success message when the printer is created', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      page.saves[0]?.next({ printer: makePrinter(), restored: false });
      await page.fixture.whenStable();

      expect(page.navigate).toHaveBeenCalledWith(['/impresoras'], {
        state: { notice: 'created' },
      });
    });

    it('disables the button while saving and sends one request for a double click', async () => {
      const page = await render();
      await page.fillValid();
      const submit = page.button('Guardar');

      submit?.click();
      submit?.click();
      await page.fixture.whenStable();

      expect(page.api.create).toHaveBeenCalledTimes(1);
      const saving = page.button('Guardando…');
      expect(saving?.disabled).toBe(true);
    });

    it('shows a Spanish name error, focuses the name and keeps the data on a duplicate name', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'name', message: 'Another printer uses it.' }]));

      expect(page.errorOf('name-error')).toBe('Ya existe una impresora con ese nombre.');
      expect(page.byId('field-name')?.getAttribute('aria-describedby')).toBe('name-error');
      expect(document.activeElement).toBe(page.byId('field-name'));
      expect(page.byId('field-name')?.value).toBe('Prusa MK4');
      expect(page.byId('field-x')?.value).toBe('250');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('lets the user retry after fixing the duplicate name', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();
      await page.rejectSave(problem(409, [{ path: 'name', message: 'dup' }]));

      await page.type('field-name', 'Prusa MK4 bis');
      await page.submit();

      expect(page.api.create).toHaveBeenCalledTimes(2);
    });

    it('shows a generic conflict message for a 409 it does not recognise', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'other', message: 'x' }]));

      const alert = page.element.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('conflicto');
      expect(alert?.textContent).not.toContain('Recargar');
      expect(page.errorOf('name-error')).toBeNull();
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('shows a message on the materials when the API rejects the combination', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(
        problem(400, [{ path: 'compatibleMaterials', message: 'Needs hardened steel.' }]),
      );

      expect(page.errorOf('materials-error')).toBe(
        'Los materiales elegidos no son compatibles con esta boquilla. Revisá la selección.',
      );
      expect(page.element.innerHTML).not.toContain('Needs hardened steel');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(document.activeElement).toBe(page.byId('material-PLA'));
    });

    it('shows the safe message for a server failure without backend text', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(500));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.navigate).not.toHaveBeenCalled();
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('shows a generic message when the failure is not an ApiError', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(new Error(SENTINEL));

      expect(page.text()).toContain('Ocurrió un error inesperado');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });
  });

  it('renders a hostile name typed by the user as text only', async () => {
    const page = await render();
    await page.fillValid();
    await page.type('field-name', '<img src=x onerror=alert(1)>');

    await page.submit();

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.api.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '<img src=x onerror=alert(1)>' }),
    );
  });
});

describe('PrinterFormPage (restore a deleted printer)', () => {
  const restorable = () => problem(409, [{ path: 'restoreIfDeleted', message: 'Deleted holder.' }]);

  async function openDialog() {
    const page = await render();
    await page.fillValid();
    await page.submit();
    await page.rejectSave(restorable());
    const dialog = () => page.element.querySelector('dialog');
    const dialogButton = (label: string) =>
      Array.from(dialog()?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent.trim() === label,
      );
    return { page, dialog, dialogButton };
  }

  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });

  it('opens the confirmation instead of the duplicate-name error', async () => {
    const { page, dialog } = await openDialog();

    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    expect(dialog()?.textContent).toContain('«Prusa MK4»');
    expect(page.errorOf('name-error')).toBeNull();
    expect(page.text()).not.toContain('Ya existe una impresora con ese nombre.');
    expect(page.element.innerHTML).not.toContain(SENTINEL);
  });

  it('keeps the data, focuses the name and shows a hint when the user cancels', async () => {
    const { page, dialog, dialogButton } = await openDialog();

    dialogButton('Cancelar')?.click();
    await page.fixture.whenStable();

    expect(dialog()).toBeNull();
    expect(page.api.create).toHaveBeenCalledTimes(1);
    expect(page.byId('field-name')?.value).toBe('Prusa MK4');
    expect(page.byId('field-x')?.value).toBe('250');
    expect(document.activeElement).toBe(page.byId('field-name'));
    expect(page.errorOf('name-restore-hint')).toBe(
      'Ese nombre pertenece a una impresora eliminada. Cambialo o restaurala.',
    );
    expect(page.byId('field-name')?.getAttribute('aria-describedby')).toBe('name-restore-hint');
    expect(page.button('Guardar')?.disabled).toBe(false);
  });

  it('opens the dialog again when the user submits again after cancelling', async () => {
    const { page, dialogButton } = await openDialog();
    dialogButton('Cancelar')?.click();
    await page.fixture.whenStable();

    await page.submit();
    await page.rejectSave(restorable());

    expect(page.api.create).toHaveBeenCalledTimes(2);
    expect(page.element.querySelector('dialog')).not.toBeNull();
  });

  it('resends the same values with restoreIfDeleted and goes to the list with a notice', async () => {
    const { page, dialogButton } = await openDialog();
    const firstBody = page.api.create.mock.calls[0]?.[0];

    dialogButton('Restaurar')?.click();
    await page.fixture.whenStable();

    expect(page.api.create).toHaveBeenCalledTimes(2);
    expect(page.api.create.mock.calls[1]).toEqual([firstBody, { restoreIfDeleted: true }]);
    page.saves[1]?.next({ printer: makePrinter(), restored: true });
    await page.fixture.whenStable();
    expect(page.navigate).toHaveBeenCalledWith(['/impresoras'], {
      state: { notice: 'restored' },
    });
  });

  it('sends one restore request and disables the buttons while it is in flight', async () => {
    const { page, dialogButton } = await openDialog();
    const restore = dialogButton('Restaurar');

    restore?.click();
    restore?.click();
    await page.fixture.whenStable();

    expect(page.api.create).toHaveBeenCalledTimes(2);
    expect(dialogButton('Restaurando…')?.disabled).toBe(true);
    expect(dialogButton('Cancelar')?.disabled).toBe(true);
  });

  it('shows the duplicate-name error and closes the dialog when the name became live', async () => {
    const { page, dialog, dialogButton } = await openDialog();
    dialogButton('Restaurar')?.click();
    await page.fixture.whenStable();

    await page.rejectSave(problem(409, [{ path: 'name', message: 'Live now.' }]));

    expect(dialog()).toBeNull();
    expect(page.errorOf('name-error')).toBe('Ya existe una impresora con ese nombre.');
    expect(document.activeElement).toBe(page.byId('field-name'));
    expect(page.byId('field-name')?.value).toBe('Prusa MK4');
  });

  it('shows a generic error, closes the dialog and keeps the data when restoring fails', async () => {
    const { page, dialog, dialogButton } = await openDialog();
    dialogButton('Restaurar')?.click();
    await page.fixture.whenStable();

    await page.rejectSave(problem(500));

    expect(dialog()).toBeNull();
    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'Mensaje seguro en español.',
    );
    expect(page.element.innerHTML).not.toContain(SENTINEL);
    expect(page.byId('field-name')?.value).toBe('Prusa MK4');
    expect(page.navigate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(page.button('Guardar'));
  });

  it('does not open the dialog for a plain duplicate name', async () => {
    const page = await render();
    await page.fillValid();
    await page.submit();

    await page.rejectSave(problem(409, [{ path: 'name', message: 'dup' }]));

    expect(page.element.querySelector('dialog')).toBeNull();
    expect(page.errorOf('name-error')).toBe('Ya existe una impresora con ese nombre.');
  });

  it('never opens the dialog when editing', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro');
    await page.submit();

    await page.rejectSave(restorable());

    expect(page.element.querySelector('dialog')).toBeNull();
    expect(page.api.create).not.toHaveBeenCalled();
  });
});

describe('PrinterFormPage (edit)', () => {
  it('shows a loading message and no form while the printer loads', async () => {
    const page = await render({ editing: true });

    expect(page.element.querySelector('h1')?.textContent).toBe('Editar impresora');
    expect(page.text()).toContain('Cargando la impresora');
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.api.get).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('fills the form with the loaded printer', async () => {
    const page = await renderEditing(
      makePrinter({
        nozzle: { diameterMm: 0.2, material: 'hardened_steel' },
        compatibleMaterials: ['PA_CF', 'PLA'],
        status: 'in_use',
      }),
    );

    expect(page.byId('field-name')?.value).toBe('Ender 3 Pro');
    expect(page.byId('field-x')?.value).toBe('220');
    expect(page.byId('field-speed')?.value).toBe('60');
    expect(page.byId('material-PA_CF')?.checked).toBe(true);
    expect(page.byId('material-PA_CF')?.disabled).toBe(false);
    expect(page.byId('material-PETG')?.checked).toBe(false);
    expect(page.selectById('field-status')?.selectedOptions[0]?.textContent.trim()).toBe('En uso');
    expect(page.text()).not.toContain('Se quitaron los materiales con fibra');
  });

  it('sends the loaded version and only the changed field', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Ender 3 V2');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledExactlyOnceWith('p1', {
      version: 3,
      name: 'Ender 3 V2',
    });
  });

  it('sends the whole build volume when one dimension changes', async () => {
    const page = await renderEditing();
    await page.type('field-z', '300');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', {
      version: 3,
      buildVolume: { x: 220, y: 220, z: 300 },
    });
  });

  it('sends the whole nozzle when its diameter changes', async () => {
    const page = await renderEditing();
    await page.pick('field-diameter', '0,4 mm');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', {
      version: 3,
      nozzle: { diameterMm: 0.4, material: 'brass' },
    });
  });

  it('sends null for the typical speed when the user clears it', async () => {
    const page = await renderEditing();
    await page.type('field-speed', '');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', { version: 3, typicalSpeedMmS: null });
  });

  it('shows the stored power and sends null when the user clears it', async () => {
    const page = await renderEditing();
    expect(page.byId('field-power')?.value).toBe('120');
    await page.type('field-power', '');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', { version: 3, powerWatts: null });
  });

  it('sends only the new power when it changes', async () => {
    const page = await renderEditing();
    await page.type('field-power', '200');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', { version: 3, powerWatts: 200 });
  });

  it('sends the status and the materials when they change', async () => {
    const page = await renderEditing();
    await page.pick('field-status', 'En mantenimiento');
    await page.check('ABS');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', {
      version: 3,
      status: 'maintenance',
      compatibleMaterials: ['PLA', 'PETG', 'ABS'],
    });
  });

  it('goes back to the list without a request when nothing changed', async () => {
    const page = await renderEditing();

    await page.submit();

    expect(page.api.update).not.toHaveBeenCalled();
    expect(page.navigate).toHaveBeenCalledWith(['/impresoras']);
  });

  it('goes to the list with a success message when the changes are saved', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro');
    await page.submit();

    page.saves[0]?.next(makePrinter({ name: 'Otro', version: 4 }));
    await page.fixture.whenStable();

    expect(page.navigate).toHaveBeenCalledWith(['/impresoras'], { state: { notice: 'updated' } });
  });

  describe('conflicts', () => {
    it('tells the user someone else changed the printer when the version is stale', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'version', message: 'stale' }]));

      const alert = page.element.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Alguien modificó esta impresora');
      expect(page.button('Recargar')).toBeDefined();
      expect(page.errorOf('name-error')).toBeNull();
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('reloads the printer, with its new version, when Recargar is pressed', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.submit();
      await page.rejectSave(problem(409, [{ path: 'version', message: 'stale' }]));

      await page.fixture.whenStable();
      page.button('Recargar')?.click();
      await page.fixture.whenStable();
      expect(page.api.get).toHaveBeenCalledTimes(2);
      await page.loadPrinter(makePrinter({ name: 'Nombre del otro', version: 4 }));
      await page.type('field-speed', '90');
      await page.submit();

      expect(page.byId('field-name')?.value).toBe('Nombre del otro');
      expect(page.api.update).toHaveBeenLastCalledWith('p1', { version: 4, typicalSpeedMmS: 90 });
    });

    it('keeps the two 409 causes apart: duplicate name versus stale version', async () => {
      const duplicate = await renderEditing();
      await duplicate.type('field-name', 'Repetido');
      await duplicate.submit();
      await duplicate.rejectSave(problem(409, [{ path: 'name', message: 'dup' }]));
      const duplicateText = duplicate.text();
      TestBed.resetTestingModule();

      const stale = await renderEditing();
      await stale.type('field-name', 'Repetido');
      await stale.submit();
      await stale.rejectSave(problem(409, [{ path: 'version', message: 'stale' }]));

      expect(duplicateText).toContain('Ya existe una impresora con ese nombre.');
      expect(duplicateText).not.toContain('Recargar');
      expect(stale.text()).not.toContain('Ya existe una impresora con ese nombre.');
      expect(stale.text()).toContain('Recargar');
    });
  });

  it('leaves for the list with a message when the printer vanished before saving', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro');
    await page.submit();

    await page.rejectSave(problem(404));

    expect(page.navigate).toHaveBeenCalledWith(['/impresoras'], { state: { notice: 'gone' } });
  });

  it('says the printer no longer exists when loading it answers 404', async () => {
    const page = await render({ editing: true });

    page.gets[0]?.error(problem(404));
    await page.fixture.whenStable();

    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'La impresora ya no existe.',
    );
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.element.querySelector('a[href="/impresoras"]')).not.toBeNull();
  });

  it('shows a safe error with a retry when loading fails, and retries', async () => {
    const page = await render({ editing: true });
    page.gets[0]?.error(problem(500));
    await page.fixture.whenStable();
    expect(page.text()).toContain('Mensaje seguro en español.');
    expect(page.element.innerHTML).not.toContain(SENTINEL);

    page.button('Reintentar')?.click();
    await page.fixture.whenStable();
    await page.loadPrinter(makePrinter());

    expect(page.api.get).toHaveBeenCalledTimes(2);
    expect(page.byId('field-name')?.value).toBe('Ender 3 Pro');
  });

  it('offers no editing for a printer that is pending removal', async () => {
    const page = await renderEditing(makePrinter({ archivedAt: '2026-02-01T10:00:00.000Z' }));

    expect(page.text()).toContain('pendiente de eliminar y ya no se puede editar');
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.button('Guardar')).toBeUndefined();
    expect(page.api.update).not.toHaveBeenCalled();
  });
});
