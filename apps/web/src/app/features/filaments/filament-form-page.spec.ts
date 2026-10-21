import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { Filament } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { FilamentFormPage } from './filament-form-page';
import { FilamentsApi } from './filaments-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

function makeFilament(overrides: Partial<Filament> = {}): Filament {
  return {
    id: 'f1',
    brand: 'Grilon3',
    material: 'PLA',
    colorName: 'Negro',
    initialGrams: 1000,
    availableGrams: 800,
    purchaseCostMinor: 1500050,
    purchaseDate: '2026-10-01',
    version: 3,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

async function render(options: { editing?: boolean } = {}) {
  const gets: Subject<Filament>[] = [];
  const saves: Subject<Filament>[] = [];
  const api = {
    get: vi.fn((_id: string) => {
      const reply = new Subject<Filament>();
      gets.push(reply);
      return reply;
    }),
    create: vi.fn((_body: unknown) => {
      const reply = new Subject<Filament>();
      saves.push(reply);
      return reply;
    }),
    update: vi.fn((_id: string, _body: unknown) => {
      const reply = new Subject<Filament>();
      saves.push(reply);
      return reply;
    }),
  };
  const params = options.editing === true ? { id: 'f1' } : {};
  TestBed.configureTestingModule({
    imports: [FilamentFormPage],
    providers: [
      provideRouter([]),
      { provide: FilamentsApi, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(FilamentFormPage);
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
    async submit() {
      view.button('Guardar')?.click();
      await fixture.whenStable();
    },
    async fillValid() {
      await view.type('field-brand', 'Grilon3');
      await view.type('field-color', 'Negro');
      await view.type('field-initial-grams', '1000');
      await view.type('field-cost', '15000,5');
      await view.type('field-date', '01-10-2026');
    },
    async loadFilament(filament: Filament) {
      gets[gets.length - 1]?.next(filament);
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

async function renderEditing(filament: Filament = makeFilament()) {
  const view = await render({ editing: true });
  await view.loadFilament(filament);
  return view;
}

describe('FilamentFormPage (create)', () => {
  it('has one h1 and a label for every control', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Nuevo filamento');
    const controls = Array.from(page.element.querySelectorAll('input, select'));
    expect(controls).toHaveLength(8);
    for (const control of controls) {
      const labelled = control as HTMLInputElement;
      expect(labelled.labels?.length, `control ${labelled.id} has no label`).toBeGreaterThan(0);
    }
    const labels = Array.from(page.element.querySelectorAll('label')).map((l) =>
      l.textContent.trim(),
    );
    expect(labels).toEqual([
      'Marca',
      'Material',
      'Color',
      'Peso inicial (g)',
      'Gramos disponibles (g), opcional',
      'Costo de compra (pesos)',
      'Fecha de compra',
      'Calendario de fecha de compra',
    ]);
  });

  it('offers the 14 materials in Spanish and starts on PLA', async () => {
    const page = await render();

    const select = page.selectById('field-material');
    expect(select?.options).toHaveLength(14);
    expect(select?.selectedOptions[0]?.textContent.trim()).toBe('PLA');
    expect(Array.from(select?.options ?? []).map((o) => o.textContent.trim())).toContain(
      'Nailon con fibra de vidrio (PA-GF)',
    );
  });

  it('limits the purchase date to today in UTC, so Argentina is never rejected for today', async () => {
    const page = await render();

    expect(page.byId('field-date')?.getAttribute('placeholder')).toBe('DD-MM-AAAA');
    expect(page.byId('field-date')?.getAttribute('type')).toBe('text');
  });

  it('asks for the cost as text with a decimal keyboard', async () => {
    const page = await render();

    expect(page.byId('field-cost')?.getAttribute('type')).toBe('text');
    expect(page.byId('field-cost')?.getAttribute('inputmode')).toBe('decimal');
  });

  it('submits through a real submit button inside the form, so Enter works', async () => {
    const page = await render();
    await page.fillValid();

    page.element.querySelector('form')?.dispatchEvent(new Event('submit'));
    await page.fixture.whenStable();

    expect(page.element.querySelector('form button[type="submit"]')).not.toBeNull();
    expect(page.api.create).toHaveBeenCalledTimes(1);
  });

  describe('client validation', () => {
    it('blocks an empty form, links each error to its field and focuses the first one', async () => {
      const page = await render();

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(page.byId('field-brand'));
      const brand = page.byId('field-brand');
      expect(brand?.getAttribute('aria-invalid')).toBe('true');
      expect(brand?.getAttribute('aria-describedby')).toBe('field-brand-error');
      expect(page.errorOf('field-brand-error')).toBe('Ingresá la marca.');
      expect(page.errorOf('field-color-error')).toBe('Ingresá el color.');
      expect(page.errorOf('field-initial-grams-error')).toBe(
        'Ingresá un número entero entre 1 y 20000.',
      );
      expect(page.errorOf('field-cost-error')).toContain('Ingresá el costo en pesos');
      expect(page.errorOf('field-date-error')).toContain('fecha de compra válida');
    });

    it('rejects a brand of spaces and one over 60 characters, and accepts exactly 60', async () => {
      const page = await render();
      await page.fillValid();

      await page.type('field-brand', '    ');
      await page.submit();
      expect(page.errorOf('field-brand-error')).toBe('Ingresá la marca.');

      await page.type('field-brand', 'a'.repeat(61));
      await page.submit();
      expect(page.errorOf('field-brand-error')).toBe('La marca puede tener hasta 60 caracteres.');
      expect(page.api.create).not.toHaveBeenCalled();

      await page.type('field-brand', 'a'.repeat(60));
      await page.submit();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a colour over 40 characters but accepts exactly 40', async () => {
      const page = await render();
      await page.fillValid();

      await page.type('field-color', 'a'.repeat(41));
      await page.submit();
      expect(page.errorOf('field-color-error')).toBe('El color puede tener hasta 40 caracteres.');

      await page.type('field-color', 'a'.repeat(40));
      await page.submit();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it.each(['0', '20001', '1.5', '-3'])('rejects an initial weight of %s', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-initial-grams', value);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('field-initial-grams-error')).toBe(
        'Ingresá un número entero entre 1 y 20000.',
      );
      expect(document.activeElement).toBe(page.byId('field-initial-grams'));
    });

    it.each(['1', '20000'])('accepts the boundary initial weight %s', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-initial-grams', value);

      await page.submit();

      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it.each(['-1', '20001', '2.5'])('rejects available grams of %s', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-available-grams', value);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('field-available-grams-error')).toBeTruthy();
      expect(document.activeElement).toBe(page.byId('field-available-grams'));
    });

    it('accepts zero available grams (an empty spool)', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-available-grams', '0');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(expect.objectContaining({ availableGrams: 0 }));
    });

    it('rejects available grams above the initial weight and accepts them when equal', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-available-grams', '1001');

      await page.submit();
      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('field-available-grams-error')).toBe(
        'Los gramos disponibles no pueden superar el peso inicial.',
      );

      await page.type('field-available-grams', '1000');
      await page.submit();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('checks available against initial again when the initial weight changes', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-available-grams', '800');
      await page.type('field-initial-grams', '500');

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('field-available-grams-error')).toBe(
        'Los gramos disponibles no pueden superar el peso inicial.',
      );
    });

    it.each(['15.000', '1,234', 'abc', ',5', '10000001', '-1'])(
      'rejects the cost %j',
      async (value) => {
        const page = await render();
        await page.fillValid();
        await page.type('field-cost', value);

        await page.submit();

        expect(page.api.create).not.toHaveBeenCalled();
        expect(page.errorOf('field-cost-error')).toContain('Ingresá el costo en pesos');
        expect(document.activeElement).toBe(page.byId('field-cost'));
      },
    );

    it('rejects a purchase date later than today', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-date', '01-01-2999');

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('field-date-error')).toContain('no sea posterior a hoy');
      expect(document.activeElement).toBe(page.byId('field-date'));
    });

    it('keeps the cost hint linked to the field together with its error', async () => {
      const page = await render();
      expect(page.byId('field-cost')?.getAttribute('aria-describedby')).toBe('cost-hint');

      await page.submit();

      expect(page.byId('field-cost')?.getAttribute('aria-describedby')).toBe(
        'cost-hint field-cost-error',
      );
    });
  });

  describe('saving', () => {
    it('creates the filament with integer centavos and omits an empty availableGrams', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-brand', '  Grilon3  ');
      await page.pick('field-material', 'PETG');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledExactlyOnceWith({
        brand: 'Grilon3',
        material: 'PETG',
        colorName: 'Negro',
        initialGrams: 1000,
        purchaseCostMinor: 1500050,
        purchaseDate: '2026-10-01',
      });
      const body = page.api.create.mock.calls[0]?.[0] as object;
      expect('availableGrams' in body).toBe(false);
      expect('version' in body).toBe(false);
    });

    it('sends the available grams when the user fills them in', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-available-grams', '250');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(
        expect.objectContaining({ initialGrams: 1000, availableGrams: 250 }),
      );
    });

    it('goes to the list with a success message when the filament is created', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      page.saves[0]?.next(makeFilament());
      await page.fixture.whenStable();

      expect(page.navigate).toHaveBeenCalledWith(['/filamentos'], {
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
      expect(page.button('Guardando…')?.disabled).toBe(true);
    });

    it('maps each 400 issue to its control with a Spanish message and no backend text', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(
        problem(400, [
          { path: 'brand', message: 'Backend brand text.' },
          { path: 'material', message: 'Backend material text.' },
          { path: 'colorName', message: 'Backend color text.' },
          { path: 'initialGrams', message: 'Backend initial text.' },
          { path: 'availableGrams', message: 'Backend available text.' },
          { path: 'purchaseCostMinor', message: 'Backend cost text.' },
          { path: 'purchaseDate', message: 'Backend date text.' },
        ]),
      );

      expect(page.errorOf('field-brand-error')).toBe('La marca no es válida.');
      expect(page.errorOf('field-material-error')).toBe('El material no es válido.');
      expect(page.errorOf('field-color-error')).toBe('El color no es válido.');
      expect(page.errorOf('field-initial-grams-error')).toBe('El peso inicial no es válido.');
      expect(page.errorOf('field-available-grams-error')).toBe(
        'Los gramos disponibles no son válidos.',
      );
      expect(page.errorOf('field-cost-error')).toBe('El costo no es válido.');
      expect(page.errorOf('field-date-error')).toBe('La fecha de compra no es válida.');
      expect(page.element.innerHTML).not.toContain('Backend');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(document.activeElement).toBe(page.byId('field-brand'));
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('focuses the first control the API complained about', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(400, [{ path: 'purchaseCostMinor', message: 'x' }]));

      expect(document.activeElement).toBe(page.byId('field-cost'));
    });

    it('clears a server error on a field once the user edits it', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();
      await page.rejectSave(problem(400, [{ path: 'purchaseCostMinor', message: 'x' }]));

      await page.type('field-cost', '15000');

      expect(page.errorOf('field-cost-error')).toBeNull();
    });

    it('shows the safe API message when a 400 names no known field', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(400, [{ path: 'unknown', message: 'x' }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('shows a generic conflict message, without Recargar, for any other 409', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'other', message: 'x' }]));

      const alert = page.element.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('conflicto');
      expect(alert?.textContent).not.toContain('Recargar');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
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

  it('renders a hostile brand typed by the user as text only', async () => {
    const page = await render();
    await page.fillValid();
    await page.type('field-brand', '<img src=x onerror=alert(1)>');

    await page.submit();

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.api.create).toHaveBeenCalledWith(
      expect.objectContaining({ brand: '<img src=x onerror=alert(1)>' }),
    );
  });
});

describe('FilamentFormPage (edit)', () => {
  it('shows a loading message and no form while the filament loads', async () => {
    const page = await render({ editing: true });

    expect(page.element.querySelector('h1')?.textContent).toBe('Editar filamento');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
      'Cargando el filamento',
    );
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.api.get).toHaveBeenCalledExactlyOnceWith('f1');
  });

  it('fills the form with the loaded filament, showing the cost in pesos', async () => {
    const page = await renderEditing(makeFilament({ material: 'TPU' }));

    expect(page.byId('field-brand')?.value).toBe('Grilon3');
    expect(page.selectById('field-material')?.selectedOptions[0]?.textContent.trim()).toBe('TPU');
    expect(page.byId('field-color')?.value).toBe('Negro');
    expect(page.byId('field-initial-grams')?.value).toBe('1000');
    expect(page.byId('field-available-grams')?.value).toBe('800');
    expect(page.byId('field-cost')?.value).toBe('15000,50');
    expect(page.byId('field-date')?.value).toBe('01-10-2026');
    expect(
      page.element.querySelector('label[for="field-available-grams"]')?.textContent.trim(),
    ).toBe('Gramos disponibles (g)');
  });

  it('requires the available grams on edit', async () => {
    const page = await renderEditing();
    await page.type('field-available-grams', '');

    await page.submit();

    expect(page.api.update).not.toHaveBeenCalled();
    expect(page.errorOf('field-available-grams-error')).toBeTruthy();
  });

  it('sends the loaded version and only the changed field', async () => {
    const page = await renderEditing();
    await page.type('field-color', 'Blanco');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledExactlyOnceWith('f1', {
      version: 3,
      colorName: 'Blanco',
    });
  });

  it('sends every field that changed, with the cost in centavos', async () => {
    const page = await renderEditing();
    await page.type('field-brand', 'eSun');
    await page.pick('field-material', 'ABS');
    await page.type('field-initial-grams', '2000');
    await page.type('field-available-grams', '1500');
    await page.type('field-cost', '0,01');
    await page.type('field-date', '30-09-2026');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledExactlyOnceWith('f1', {
      version: 3,
      brand: 'eSun',
      material: 'ABS',
      initialGrams: 2000,
      availableGrams: 1500,
      purchaseCostMinor: 1,
      purchaseDate: '2026-09-30',
    });
  });

  it('does not treat an equivalent way of writing the cost as a change', async () => {
    const page = await renderEditing();
    await page.type('field-cost', '15000,5');
    await page.type('field-brand', 'Otra');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('f1', { version: 3, brand: 'Otra' });
  });

  it('goes back to the list without a request when nothing changed', async () => {
    const page = await renderEditing();

    await page.submit();

    expect(page.api.update).not.toHaveBeenCalled();
    expect(page.navigate).toHaveBeenCalledWith(['/filamentos']);
  });

  it('goes to the list with a success message when the changes are saved', async () => {
    const page = await renderEditing();
    await page.type('field-color', 'Rojo');
    await page.submit();

    page.saves[0]?.next(makeFilament({ colorName: 'Rojo', version: 4 }));
    await page.fixture.whenStable();

    expect(page.navigate).toHaveBeenCalledWith(['/filamentos'], { state: { notice: 'updated' } });
  });

  it('sends one request for a double click on Guardar', async () => {
    const page = await renderEditing();
    await page.type('field-color', 'Rojo');
    const submit = page.button('Guardar');

    submit?.click();
    submit?.click();
    await page.fixture.whenStable();

    expect(page.api.update).toHaveBeenCalledTimes(1);
    expect(page.button('Guardando…')?.disabled).toBe(true);
  });

  describe('conflicts', () => {
    it('tells the user someone else changed the filament when the version is stale', async () => {
      const page = await renderEditing();
      await page.type('field-color', 'Mi cambio');
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'version', message: 'stale' }]));

      const alert = page.element.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Alguien modificó este filamento');
      expect(alert?.textContent).toContain('se descontó material');
      expect(page.button('Recargar')).toBeDefined();
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('reloads the filament, with its new version, when Recargar is pressed', async () => {
      const page = await renderEditing();
      await page.type('field-color', 'Mi cambio');
      await page.submit();
      await page.rejectSave(problem(409, [{ path: 'version', message: 'stale' }]));

      page.button('Recargar')?.click();
      await page.fixture.whenStable();
      expect(page.api.get).toHaveBeenCalledTimes(2);
      await page.loadFilament(
        makeFilament({ colorName: 'Del otro', availableGrams: 770, version: 4 }),
      );
      await page.type('field-brand', 'eSun');
      await page.submit();

      expect(page.byId('field-color')?.value).toBe('Del otro');
      expect(page.byId('field-available-grams')?.value).toBe('770');
      expect(page.api.update).toHaveBeenLastCalledWith('f1', { version: 4, brand: 'eSun' });
    });
  });

  it('leaves for the list with a message when the filament vanished before saving', async () => {
    const page = await renderEditing();
    await page.type('field-color', 'Rojo');
    await page.submit();

    await page.rejectSave(problem(404));

    expect(page.navigate).toHaveBeenCalledWith(['/filamentos'], { state: { notice: 'gone' } });
  });

  it('says the filament no longer exists when loading it answers 404', async () => {
    const page = await render({ editing: true });

    page.gets[0]?.error(problem(404));
    await page.fixture.whenStable();

    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'El filamento ya no existe.',
    );
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.element.querySelector('a[href="/filamentos"]')).not.toBeNull();
  });

  it('shows a safe error with a retry when loading fails, and retries', async () => {
    const page = await render({ editing: true });
    page.gets[0]?.error(problem(500));
    await page.fixture.whenStable();
    expect(page.text()).toContain('Mensaje seguro en español.');
    expect(page.element.innerHTML).not.toContain(SENTINEL);

    page.button('Reintentar')?.click();
    await page.fixture.whenStable();
    await page.loadFilament(makeFilament());

    expect(page.api.get).toHaveBeenCalledTimes(2);
    expect(page.byId('field-brand')?.value).toBe('Grilon3');
  });
});
