import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { GcodeAnalysis, Part } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { GcodeAnalysisApi } from './gcode-analysis-api';
import { PartFormPage } from './part-form-page';
import { PartsApi } from './parts-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';
const HOSTILE = '<img src=x onerror=alert(1)>';

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'p1',
    name: 'Soporte de cable',
    description: 'Para el escritorio',
    material: 'PLA',
    dimensionsMm: { x: 40, y: 30, z: 20 },
    estimatedWeightGrams: 25,
    estimatedPrintSeconds: 7380,
    layerHeightUm: 200,
    suggestedPrinterName: 'Ender 3',
    source: { kind: 'manual' },
    version: 3,
    createdAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<GcodeAnalysis> = {}): GcodeAnalysis {
  return {
    slicer: 'cura',
    estimatedPrintSeconds: 5025,
    filamentMm: 8123,
    filamentGrams: 24,
    layerHeightUm: 160,
    dimensionsMm: { x: 61, y: 52, z: 33 },
    targetMachineName: 'Creality Ender-3',
    warnings: [],
    ...overrides,
  };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

const CURA_HEAD = ';FLAVOR:Marlin\n;TIME:5025\n;Filament used: 8.123m\n;Layer height: 0.16\n';

async function render(options: { editing?: boolean } = {}) {
  const gets: Subject<Part>[] = [];
  const saves: Subject<Part>[] = [];
  const analyses: { head: string; material: string | undefined; reply: Subject<GcodeAnalysis> }[] =
    [];
  const api = {
    get: vi.fn((_id: string) => {
      const reply = new Subject<Part>();
      gets.push(reply);
      return reply;
    }),
    create: vi.fn((_body: unknown) => {
      const reply = new Subject<Part>();
      saves.push(reply);
      return reply;
    }),
    update: vi.fn((_id: string, _body: unknown) => {
      const reply = new Subject<Part>();
      saves.push(reply);
      return reply;
    }),
  };
  const gcodeApi = {
    analyse: vi.fn((head: string, material?: string) => {
      const reply = new Subject<GcodeAnalysis>();
      analyses.push({ head, material, reply });
      return reply;
    }),
  };
  const params = options.editing === true ? { id: 'p1' } : {};
  TestBed.configureTestingModule({
    imports: [PartFormPage],
    providers: [
      provideRouter([]),
      { provide: PartsApi, useValue: api },
      { provide: GcodeAnalysisApi, useValue: gcodeApi },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params) } } },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PartFormPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    gcodeApi,
    navigate,
    gets,
    saves,
    analyses,
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
      await view.type('field-name', 'Soporte de cable');
      await view.type('field-dim-x', '40');
      await view.type('field-dim-y', '30');
      await view.type('field-dim-z', '20');
      await view.type('field-weight', '25');
      await view.type('field-hours', '2');
      await view.type('field-minutes', '3');
      await view.type('field-layer', '0,2');
    },
    async loadPart(part: Part) {
      gets[gets.length - 1]?.next(part);
      await fixture.whenStable();
    },
    errorOf: (id: string) => element.querySelector(`#${id}`)?.textContent.trim() ?? null,
    async rejectSave(error: unknown) {
      saves[saves.length - 1]?.error(error);
      await fixture.whenStable();
    },
    /** Picks a file in the native file input and waits until the head has been sent. */
    async selectFile(file: File) {
      const input = view.byId('field-gcode');
      if (input) Object.defineProperty(input, 'files', { value: [file], configurable: true });
      const before = analyses.length;
      input?.dispatchEvent(new Event('change'));
      await vi.waitFor(() => {
        expect(analyses.length).toBe(before + 1);
      });
      await fixture.whenStable();
    },
    async answerAnalysis(analysis: GcodeAnalysis) {
      analyses[analyses.length - 1]?.reply.next(analysis);
      analyses[analyses.length - 1]?.reply.complete();
      await fixture.whenStable();
    },
    async failAnalysis(error: unknown) {
      analyses[analyses.length - 1]?.reply.error(error);
      await fixture.whenStable();
    },
    async importCura(analysis: GcodeAnalysis = makeAnalysis(), name = 'soporte.gcode') {
      await view.selectFile(new File([CURA_HEAD], name));
      await view.answerAnalysis(analysis);
    },
  };
  return view;
}

async function renderEditing(part: Part = makePart()) {
  const view = await render({ editing: true });
  await view.loadPart(part);
  return view;
}

describe('PartFormPage (create)', () => {
  it('has one h1 and a label for every control', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Nueva pieza');
    const controls = Array.from(page.element.querySelectorAll('input, select'));
    expect(controls).toHaveLength(13);
    for (const control of controls) {
      const labelled = control as HTMLInputElement;
      expect(labelled.labels?.length, `control ${labelled.id} has no label`).toBeGreaterThan(0);
    }
    const labels = Array.from(page.element.querySelectorAll('label')).map((l) =>
      l.textContent.trim(),
    );
    expect(labels).toEqual([
      'Nombre',
      'Descripción (opcional)',
      'Material',
      'Importar desde G-code',
      'Ancho (X)',
      'Largo (Y)',
      'Alto (Z)',
      'Peso estimado (g)',
      'Horas',
      'Minutos',
      'Segundos',
      'Altura de capa (mm)',
      'Impresora sugerida (opcional)',
    ]);
    const legends = Array.from(page.element.querySelectorAll('legend')).map((l) =>
      l.textContent.trim(),
    );
    expect(legends).toEqual(['Dimensiones (mm)', 'Tiempo de impresión estimado']);
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

  it('asks for the layer height as text with a decimal keyboard', async () => {
    const page = await render();

    expect(page.byId('field-layer')?.getAttribute('type')).toBe('text');
    expect(page.byId('field-layer')?.getAttribute('inputmode')).toBe('decimal');
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
      expect(document.activeElement).toBe(page.byId('field-name'));
      const name = page.byId('field-name');
      expect(name?.getAttribute('aria-invalid')).toBe('true');
      expect(name?.getAttribute('aria-describedby')).toBe('error-name');
      expect(page.errorOf('error-name')).toBe('Ingresá el nombre.');
      expect(page.errorOf('error-dimX')).toBe('Ingresá un ancho entero entre 1 y 1000 mm.');
      expect(page.errorOf('error-dimY')).toBe('Ingresá un largo entero entre 1 y 1000 mm.');
      expect(page.errorOf('error-dimZ')).toBe('Ingresá un alto entero entre 1 y 1000 mm.');
      expect(page.errorOf('error-weight')).toBe('Ingresá un peso entero entre 1 y 20000 g.');
      expect(page.errorOf('error-time')).toContain('Ingresá un tiempo mayor a cero');
      expect(page.errorOf('error-layerHeight')).toContain('altura de capa en milímetros');
      expect(page.errorOf('error-printer')).toBeNull();
      expect(page.errorOf('error-description')).toBeNull();
    });

    it('rejects a name of spaces or over 100 characters and accepts exactly 100', async () => {
      const page = await render();
      await page.fillValid();

      await page.type('field-name', '    ');
      await page.submit();
      expect(page.errorOf('error-name')).toBe('Ingresá el nombre.');

      await page.type('field-name', 'a'.repeat(101));
      await page.submit();
      expect(page.errorOf('error-name')).toBe('El nombre puede tener hasta 100 caracteres.');
      expect(page.api.create).not.toHaveBeenCalled();

      await page.type('field-name', 'a'.repeat(100));
      await page.submit();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('accepts a name written with characters outside the basic plane', async () => {
      const page = await render();
      await page.fillValid();

      await page.type('field-name', '🙂'.repeat(100));
      await page.submit();

      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a description over 1000 characters but accepts exactly 1000 or none', async () => {
      const page = await render();
      await page.fillValid();

      await page.type('field-description', 'a'.repeat(1001));
      await page.submit();
      expect(page.errorOf('error-description')).toBe(
        'La descripción puede tener hasta 1000 caracteres.',
      );
      expect(page.api.create).not.toHaveBeenCalled();

      await page.type('field-description', 'a'.repeat(1000));
      await page.submit();
      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a suggested printer over 100 characters', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-printer', 'a'.repeat(101));

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('error-printer')).toBe(
        'La impresora sugerida puede tener hasta 100 caracteres.',
      );
      expect(document.activeElement).toBe(page.byId('field-printer'));
    });

    it.each(['0', '1001', '1.5', '-3'])('rejects a dimension of %s mm', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-dim-y', value);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('error-dimY')).toBe('Ingresá un largo entero entre 1 y 1000 mm.');
      expect(document.activeElement).toBe(page.byId('field-dim-y'));
    });

    it.each(['1', '1000'])('accepts the boundary dimension %s mm', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-dim-z', value);

      await page.submit();

      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it.each(['0', '20001', '2.5', '-1'])('rejects a weight of %s g', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-weight', value);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('error-weight')).toBeTruthy();
      expect(document.activeElement).toBe(page.byId('field-weight'));
    });

    it.each(['1', '20000'])('accepts the boundary weight %s g', async (value) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-weight', value);

      await page.submit();

      expect(page.api.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a total time of zero and focuses the hours', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-hours', '0');
      await page.type('field-minutes', '0');

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('error-time')).toContain('mayor a cero');
      expect(document.activeElement).toBe(page.byId('field-hours'));
    });

    it.each([
      ['field-minutes', '60'],
      ['field-seconds', '60'],
      ['field-hours', '721'],
      ['field-minutes', '-1'],
      ['field-seconds', '1.5'],
    ])('rejects %s = %s', async (id, value) => {
      const page = await render();
      await page.fillValid();
      await page.type(id, value);

      await page.submit();

      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('error-time')).toBeTruthy();
      expect(page.byId(id)?.getAttribute('aria-invalid')).toBe('true');
    });

    it('rejects a time just over 30 days and accepts exactly 30 days and one second', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-hours', '720');
      await page.type('field-minutes', '0');
      await page.type('field-seconds', '1');

      await page.submit();
      expect(page.api.create).not.toHaveBeenCalled();
      expect(page.errorOf('error-time')).toBeTruthy();

      await page.type('field-seconds', '0');
      await page.submit();
      expect(page.api.create).toHaveBeenCalledWith(
        expect.objectContaining({ estimatedPrintSeconds: 2_592_000 }),
      );
    });

    it('accepts one second as the shortest time', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-hours', '');
      await page.type('field-minutes', '');
      await page.type('field-seconds', '1');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(
        expect.objectContaining({ estimatedPrintSeconds: 1 }),
      );
    });

    it.each(['0,2000', 'abc', '0.2', '0,009', '2,001', '3', '0', '-0,2', ',2'])(
      'rejects the layer height %j',
      async (value) => {
        const page = await render();
        await page.fillValid();
        await page.type('field-layer', value);

        await page.submit();

        expect(page.api.create).not.toHaveBeenCalled();
        expect(page.errorOf('error-layerHeight')).toContain('altura de capa en milímetros');
        expect(document.activeElement).toBe(page.byId('field-layer'));
      },
    );

    it.each([
      ['0,01', 10],
      ['0,16', 160],
      ['0,2', 200],
      ['2', 2000],
    ])('sends the layer height %j as %i micrometres', async (value, um) => {
      const page = await render();
      await page.fillValid();
      await page.type('field-layer', value);

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(expect.objectContaining({ layerHeightUm: um }));
    });

    it('keeps the layer hint linked to the field together with its error', async () => {
      const page = await render();
      expect(page.byId('field-layer')?.getAttribute('aria-describedby')).toBe('layer-hint');

      await page.submit();

      expect(page.byId('field-layer')?.getAttribute('aria-describedby')).toBe(
        'layer-hint error-layerHeight',
      );
    });
  });

  describe('saving', () => {
    it('creates the part without a source, a description or a printer when none were given', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-name', '  Soporte de cable  ');
      await page.pick('field-material', 'PETG');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledExactlyOnceWith({
        name: 'Soporte de cable',
        material: 'PETG',
        dimensionsMm: { x: 40, y: 30, z: 20 },
        estimatedWeightGrams: 25,
        estimatedPrintSeconds: 7380,
        layerHeightUm: 200,
      });
      const body = page.api.create.mock.calls[0]?.[0] as object;
      expect('source' in body).toBe(false);
      expect('version' in body).toBe(false);
    });

    it('sends the optional description and suggested printer when they are filled in', async () => {
      const page = await render();
      await page.fillValid();
      await page.type('field-description', ' Para el escritorio ');
      await page.type('field-printer', 'Ender 3');

      await page.submit();

      expect(page.api.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Para el escritorio',
          suggestedPrinterName: 'Ender 3',
        }),
      );
    });

    it('goes to the list with a success message when the part is created', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      page.saves[0]?.next(makePart());
      await page.fixture.whenStable();

      expect(page.navigate).toHaveBeenCalledWith(['/piezas'], { state: { notice: 'created' } });
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
          { path: 'name', message: 'Backend name text.' },
          { path: 'description', message: 'Backend description text.' },
          { path: 'material', message: 'Backend material text.' },
          { path: 'dimensionsMm.x', message: 'Backend x text.' },
          { path: 'dimensionsMm.y', message: 'Backend y text.' },
          { path: 'dimensionsMm.z', message: 'Backend z text.' },
          { path: 'estimatedWeightGrams', message: 'Backend weight text.' },
          { path: 'estimatedPrintSeconds', message: 'Backend time text.' },
          { path: 'layerHeightUm', message: 'Backend layer text.' },
          { path: 'suggestedPrinterName', message: 'Backend printer text.' },
        ]),
      );

      expect(page.errorOf('error-name')).toBe('El nombre no es válido.');
      expect(page.errorOf('error-description')).toBe('La descripción no es válida.');
      expect(page.errorOf('error-material')).toBe('El material no es válido.');
      expect(page.errorOf('error-dimX')).toBe('El ancho (X) no es válido.');
      expect(page.errorOf('error-dimY')).toBe('El largo (Y) no es válido.');
      expect(page.errorOf('error-dimZ')).toBe('El alto (Z) no es válido.');
      expect(page.errorOf('error-weight')).toBe('El peso estimado no es válido.');
      expect(page.errorOf('error-time')).toBe('El tiempo de impresión no es válido.');
      expect(page.errorOf('error-layerHeight')).toBe('La altura de capa no es válida.');
      expect(page.errorOf('error-printer')).toBe('La impresora sugerida no es válida.');
      expect(page.element.innerHTML).not.toContain('Backend');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(document.activeElement).toBe(page.byId('field-name'));
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('clears a server error on the time once the user edits any of its fields', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();
      await page.rejectSave(problem(400, [{ path: 'estimatedPrintSeconds', message: 'x' }]));
      expect(document.activeElement).toBe(page.byId('field-hours'));

      await page.type('field-minutes', '4');

      expect(page.errorOf('error-time')).toBeNull();
    });

    it('clears a server error on a field once the user edits it', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();
      await page.rejectSave(problem(400, [{ path: 'layerHeightUm', message: 'x' }]));

      await page.type('field-layer', '0,3');

      expect(page.errorOf('error-layerHeight')).toBeNull();
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

    it('shows the safe message for a 413 without backend text', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(413));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.navigate).not.toHaveBeenCalled();
    });

    it('shows the safe message for a server failure and lets the user try again', async () => {
      const page = await render();
      await page.fillValid();
      await page.submit();

      await page.rejectSave(problem(500));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.element.innerHTML).not.toContain(SENTINEL);
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

  it('sends a hostile name typed by the user as text only', async () => {
    const page = await render();
    await page.fillValid();
    await page.type('field-name', HOSTILE);

    await page.submit();

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.api.create).toHaveBeenCalledWith(expect.objectContaining({ name: HOSTILE }));
  });
});

describe('PartFormPage (import from G-code)', () => {
  it('sends the head and the chosen material, then prefills the fields from the analysis', async () => {
    const page = await render();
    await page.pick('field-material', 'PETG');

    await page.importCura();

    expect(page.gcodeApi.analyse).toHaveBeenCalledExactlyOnceWith(CURA_HEAD, 'PETG');
    expect(page.byId('field-weight')?.value).toBe('24');
    expect(page.byId('field-hours')?.value).toBe('1');
    expect(page.byId('field-minutes')?.value).toBe('23');
    expect(page.byId('field-seconds')?.value).toBe('45');
    expect(page.byId('field-dim-x')?.value).toBe('61');
    expect(page.byId('field-dim-y')?.value).toBe('52');
    expect(page.byId('field-dim-z')?.value).toBe('33');
    expect(page.byId('field-layer')?.value).toBe('0,16');
    expect(page.byId('field-printer')?.value).toBe('Creality Ender-3');
    expect(page.byId('field-name')?.value).toBe('');
  });

  it('has a native file input limited to .gcode that is reachable by keyboard', async () => {
    const page = await render();

    const input = page.byId('field-gcode');
    expect(input?.getAttribute('type')).toBe('file');
    expect(input?.getAttribute('accept')).toBe('.gcode');
    expect(input?.tabIndex).toBe(0);
    expect(input?.labels?.[0]?.textContent.trim()).toBe('Importar desde G-code');
  });

  it('marks each prefilled control with an "importado" badge that its description points to', async () => {
    const page = await render();

    await page.importCura();

    expect(Array.from(page.element.querySelectorAll('.badge')).map((b) => b.textContent)).toEqual([
      'importado',
      'importado',
      'importado',
      'importado',
      'importado',
    ]);
    expect(page.byId('field-weight')?.getAttribute('aria-describedby')).toContain('badge-weight');
    expect(page.byId('field-dim-x')?.getAttribute('aria-describedby')).toContain(
      'badge-dimensions',
    );
  });

  it('clears the badge of a control as soon as the user edits it, and only that one', async () => {
    const page = await render();
    await page.importCura();

    await page.type('field-weight', '30');

    expect(page.element.querySelector('#badge-weight')).toBeNull();
    expect(page.element.querySelectorAll('.badge')).toHaveLength(4);
    expect(page.byId('field-weight')?.getAttribute('aria-describedby')).not.toContain('badge');
    expect(page.byId('field-weight')?.value).toBe('30');
  });

  it.each([
    ['field-dim-y', '95', 'badge-dimensions'],
    ['field-hours', '2', 'badge-time'],
    ['field-layer', '0,16', 'badge-layerHeight'],
    ['field-printer', 'Otra', 'badge-printer'],
  ])('clears the badge of %s when the user edits it', async (fieldId, value, badgeId) => {
    const page = await render();
    await page.importCura();
    expect(page.element.querySelector(`#${badgeId}`)).not.toBeNull();

    await page.type(fieldId, value);

    expect(page.element.querySelector(`#${badgeId}`)).toBeNull();
    expect(page.element.querySelectorAll('.badge')).toHaveLength(4);
  });

  it('keeps every prefilled value editable and saves the edited value', async () => {
    const page = await render();
    await page.importCura();
    await page.type('field-name', 'Soporte');
    await page.type('field-layer', '0,2');

    await page.submit();

    expect(page.api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        estimatedWeightGrams: 24,
        estimatedPrintSeconds: 5025,
        layerHeightUm: 200,
        suggestedPrinterName: 'Creality Ender-3',
      }),
    );
  });

  it('adds the source with the file name and slicer to the body', async () => {
    const page = await render();
    await page.importCura(makeAnalysis(), 'soporte.gcode');
    await page.type('field-name', 'Soporte');

    await page.submit();

    expect(page.api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: 'gcode', fileName: 'soporte.gcode', slicer: 'cura' },
      }),
    );
  });

  it('cuts a file name longer than 255 code points and strips control characters', async () => {
    const page = await render();
    await page.importCura(makeAnalysis(), `a\nb${'🙂'.repeat(300)}.gcode`);
    await page.type('field-name', 'Soporte');

    await page.submit();

    const body = page.api.create.mock.calls[0]?.[0] as { source: { fileName: string } };
    expect(Array.from(body.source.fileName)).toHaveLength(255);
    expect(body.source.fileName.startsWith('ab🙂')).toBe(true);
    expect(body.source.fileName).not.toContain('\n');
  });

  it('shows the warnings in a polite live region, in Spanish', async () => {
    const page = await render();

    await page.importCura(
      makeAnalysis({
        warnings: [
          { code: 'GRAMS_FROM_DENSITY_TABLE' },
          { code: 'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM' },
          { code: 'MULTIPLE_EXTRUDERS_SUMMED' },
        ],
      }),
    );

    const live = page.element.querySelector('.import [aria-live="polite"]');
    expect(live?.textContent).toContain('tabla de densidades');
    expect(live?.textContent).toContain('falda (skirt) o el borde (brim)');
    expect(live?.textContent).toContain('varios extrusores');
    expect(live?.querySelectorAll('li')).toHaveLength(3);
    expect(page.text()).not.toContain('GRAMS_FROM_DENSITY_TABLE');
  });

  it('warns that the material is missing and leaves the weight empty when grams are null', async () => {
    const page = await render();

    await page.importCura(
      makeAnalysis({ filamentGrams: null, warnings: [{ code: 'MATERIAL_NOT_SELECTED' }] }),
    );

    expect(page.element.querySelector('.import')?.textContent).toContain('No elegiste un material');
    expect(page.byId('field-weight')?.value).toBe('');
    expect(page.element.querySelector('#badge-weight')).toBeNull();
  });

  it('does not overwrite a value with nothing when the analysis lacks dimensions or layer height', async () => {
    const page = await render();
    await page.type('field-dim-x', '10');
    await page.type('field-layer', '0,3');

    await page.importCura(
      makeAnalysis({ dimensionsMm: null, layerHeightUm: null, targetMachineName: null }),
    );

    expect(page.byId('field-dim-x')?.value).toBe('10');
    expect(page.byId('field-layer')?.value).toBe('0,3');
    expect(page.element.querySelector('#badge-dimensions')).toBeNull();
    expect(page.element.querySelector('#badge-layerHeight')).toBeNull();
    expect(page.element.querySelector('#badge-printer')).toBeNull();
    expect(page.element.querySelector('#badge-time')).not.toBeNull();
  });

  it('shows the file name as text, never as markup', async () => {
    const page = await render();

    await page.importCura(makeAnalysis(), `${HOSTILE}.gcode`);

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.element.querySelector('.import')?.textContent).toContain(`«${HOSTILE}.gcode»`);
  });

  it('shows the Spanish "not Cura" message on a 400 about the head and lets the user type', async () => {
    const page = await render();
    await page.selectFile(new File([CURA_HEAD], 'otro.gcode'));

    await page.failAnalysis(problem(400, [{ path: 'head', message: 'Backend head text.' }]));

    const alert = page.element.querySelector('.import [role="alert"]');
    expect(alert?.textContent).toBe(
      'No reconocemos este G-code. Por ahora solo leemos archivos de Cura; cargá los datos a mano.',
    );
    expect(page.element.innerHTML).not.toContain('Backend');
    expect(page.element.innerHTML).not.toContain(SENTINEL);
    await page.fillValid();
    await page.submit();
    expect(page.api.create).toHaveBeenCalledTimes(1);
    expect('source' in (page.api.create.mock.calls[0]?.[0] as object)).toBe(false);
  });

  it('shows "No pudimos leer ese archivo." on a 413', async () => {
    const page = await render();
    await page.selectFile(new File([CURA_HEAD], 'enorme.gcode'));

    await page.failAnalysis(problem(413));

    expect(page.element.querySelector('.import [role="alert"]')?.textContent).toBe(
      'No pudimos leer ese archivo.',
    );
    expect(page.element.innerHTML).not.toContain(SENTINEL);
  });

  it('shows the safe API message for any other failure and never backend text', async () => {
    const page = await render();
    await page.selectFile(new File([CURA_HEAD], 'a.gcode'));

    await page.failAnalysis(problem(500));

    expect(page.element.querySelector('.import [role="alert"]')?.textContent).toBe(
      'Mensaje seguro en español.',
    );
    expect(page.element.innerHTML).not.toContain(SENTINEL);
  });

  it('shows a generic message when the failure is not an ApiError', async () => {
    const page = await render();
    await page.selectFile(new File([CURA_HEAD], 'a.gcode'));

    await page.failAnalysis(new Error(SENTINEL));

    expect(page.element.querySelector('.import [role="alert"]')?.textContent).toContain(
      'Ocurrió un error inesperado',
    );
    expect(page.element.innerHTML).not.toContain(SENTINEL);
  });

  it('shows "No pudimos leer ese archivo." when the file cannot be read, without calling the API', async () => {
    const page = await render();
    const file = new File([CURA_HEAD], 'a.gcode');
    const unreadable = new Blob(['x']);
    vi.spyOn(unreadable, 'text').mockRejectedValue(new Error(SENTINEL));
    vi.spyOn(file, 'slice').mockReturnValue(unreadable);
    const input = page.byId('field-gcode');
    if (input) Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input?.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(page.element.querySelector('.import [role="alert"]')).not.toBeNull();
    });

    expect(page.element.querySelector('.import [role="alert"]')?.textContent).toBe(
      'No pudimos leer ese archivo.',
    );
    expect(page.gcodeApi.analyse).not.toHaveBeenCalled();
    expect(page.element.innerHTML).not.toContain(SENTINEL);
  });

  it('reads only the first 65536 characters of a larger file', async () => {
    const page = await render();
    const file = new File(['a'.repeat(200_000)], 'grande.gcode');

    await page.selectFile(file);

    expect(page.analyses[0]?.head).toHaveLength(65_536);
    expect(page.analyses[0]?.head).toBe('a'.repeat(65_536));
  });

  it('asks the browser for only the first 65536 characters instead of reading the whole file', async () => {
    const page = await render();
    const file = new File(['a'.repeat(200_000)], 'grande.gcode');
    const slice = vi.spyOn(file, 'slice');

    await page.selectFile(file);

    expect(slice).toHaveBeenCalledExactlyOnceWith(0, 65_536);
  });

  it('sends a file shorter than the limit whole and untrimmed', async () => {
    const page = await render();

    await page.selectFile(new File(['  ;x\r\n'], 'corto.gcode'));

    expect(page.analyses[0]?.head).toBe('  ;x\r\n');
  });

  it('disables the file input and Guardar while the file is being analysed', async () => {
    const page = await render();

    await page.selectFile(new File([CURA_HEAD], 'a.gcode'));

    expect(page.byId('field-gcode')?.disabled).toBe(true);
    expect(page.button('Guardar')?.disabled).toBe(true);
    expect(page.element.querySelector('.import [aria-live="polite"]')?.textContent).toContain(
      'Leyendo el archivo',
    );

    await page.answerAnalysis(makeAnalysis());

    expect(page.byId('field-gcode')?.disabled).toBe(false);
    expect(page.button('Guardar')?.disabled).toBe(false);
  });

  it('shows the material hint only when the material changes after an import', async () => {
    const page = await render();
    await page.pick('field-material', 'PETG');
    expect(page.text()).not.toContain('Cambiaste el material');
    await page.importCura();
    expect(page.text()).not.toContain('Cambiaste el material');

    await page.pick('field-material', 'ABS');
    expect(page.text()).toContain(
      'Cambiaste el material: reimportá el archivo para recalcular los gramos',
    );

    await page.pick('field-material', 'PETG');
    expect(page.text()).not.toContain('Cambiaste el material');
  });

  it('sends the new material on a second import and drops the hint', async () => {
    const page = await render();
    await page.importCura();
    await page.pick('field-material', 'ASA');

    await page.importCura(makeAnalysis({ filamentGrams: 30 }));

    expect(page.analyses[1]?.material).toBe('ASA');
    expect(page.byId('field-weight')?.value).toBe('30');
    expect(page.text()).not.toContain('Cambiaste el material');
  });

  it('keeps the previous import when a later file is rejected', async () => {
    const page = await render();
    await page.importCura(makeAnalysis(), 'bueno.gcode');
    await page.selectFile(new File(['x'], 'malo.gcode'));

    await page.failAnalysis(problem(400, [{ path: 'head', message: 'x' }]));
    await page.type('field-name', 'Soporte');
    await page.submit();

    expect(page.api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: 'gcode', fileName: 'bueno.gcode', slicer: 'cura' },
      }),
    );
  });
});

describe('PartFormPage (edit)', () => {
  it('shows a loading message and no form while the part loads', async () => {
    const page = await render({ editing: true });

    expect(page.element.querySelector('h1')?.textContent).toBe('Editar pieza');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
      'Cargando la pieza',
    );
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.api.get).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('fills the form with the loaded part, showing the layer height in millimetres', async () => {
    const page = await renderEditing(makePart({ material: 'TPU', layerHeightUm: 160 }));

    expect(page.byId('field-name')?.value).toBe('Soporte de cable');
    expect(page.byId('field-description')?.value).toBe('Para el escritorio');
    expect(page.selectById('field-material')?.selectedOptions[0]?.textContent.trim()).toBe('TPU');
    expect(page.byId('field-dim-x')?.value).toBe('40');
    expect(page.byId('field-dim-y')?.value).toBe('30');
    expect(page.byId('field-dim-z')?.value).toBe('20');
    expect(page.byId('field-weight')?.value).toBe('25');
    expect(page.byId('field-hours')?.value).toBe('2');
    expect(page.byId('field-minutes')?.value).toBe('3');
    expect(page.byId('field-seconds')?.value).toBe('0');
    expect(page.byId('field-layer')?.value).toBe('0,16');
    expect(page.byId('field-printer')?.value).toBe('Ender 3');
  });

  it('shows empty optional fields as empty text when the part has none', async () => {
    const page = await renderEditing(makePart({ description: null, suggestedPrinterName: null }));

    expect(page.byId('field-description')?.value).toBe('');
    expect(page.byId('field-printer')?.value).toBe('');
  });

  it('shows the origin as manual entry', async () => {
    const page = await renderEditing();

    expect(page.element.querySelector('.origin')?.textContent.trim()).toBe('Origen: carga manual');
    expect(page.element.querySelector('label[for="field-gcode"]')?.textContent.trim()).toBe(
      'Importar desde G-code',
    );
  });

  it('shows the origin as the G-code file and the import date, offering to reimport', async () => {
    const page = await renderEditing(
      makePart({
        source: {
          kind: 'gcode',
          fileName: HOSTILE,
          slicer: 'cura',
          analyzedAt: '2026-10-15T15:00:00.000Z',
        },
      }),
    );

    const origin = page.element.querySelector('.origin')?.textContent.trim() ?? '';
    expect(origin).toMatch(
      /^Origen: G-code «<img src=x onerror=alert\(1\)>» \(Cura\), importado el 1[45]-10-2026$/,
    );
    expect(page.element.querySelector('img')).toBeNull();
    expect(page.element.querySelector('label[for="field-gcode"]')?.textContent.trim()).toBe(
      'Reimportar desde G-code',
    );
  });

  it('sends the loaded version and only the changed field', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro nombre');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledExactlyOnceWith('p1', {
      version: 3,
      name: 'Otro nombre',
    });
  });

  it('sends every field that changed, with dimensions whole and the layer height in micrometres', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Nuevo');
    await page.type('field-description', 'Otra');
    await page.pick('field-material', 'ABS');
    await page.type('field-dim-z', '25');
    await page.type('field-weight', '40');
    await page.type('field-hours', '0');
    await page.type('field-minutes', '45');
    await page.type('field-layer', '0,16');
    await page.type('field-printer', 'Prusa MK4');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledExactlyOnceWith('p1', {
      version: 3,
      name: 'Nuevo',
      description: 'Otra',
      material: 'ABS',
      dimensionsMm: { x: 40, y: 30, z: 25 },
      estimatedWeightGrams: 40,
      estimatedPrintSeconds: 2700,
      layerHeightUm: 160,
      suggestedPrinterName: 'Prusa MK4',
    });
  });

  it('sends the dimensions whole even when only one of the three changed', async () => {
    const page = await renderEditing();
    await page.type('field-dim-x', '41');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', {
      version: 3,
      dimensionsMm: { x: 41, y: 30, z: 20 },
    });
  });

  it('sends null for an optional field the user emptied', async () => {
    const page = await renderEditing();
    await page.type('field-description', '   ');
    await page.type('field-printer', '');

    await page.submit();

    expect(page.api.update).toHaveBeenCalledExactlyOnceWith('p1', {
      version: 3,
      description: null,
      suggestedPrinterName: null,
    });
  });

  it('does not treat an equivalent way of writing the layer height or time as a change', async () => {
    const page = await renderEditing();
    await page.type('field-layer', '0,20');
    await page.type('field-hours', '');
    await page.type('field-minutes', '123');
    await page.type('field-name', 'Otra');

    await page.submit();

    // 123 minutes is out of range for the minutes control: the form blocks, nothing is sent.
    expect(page.api.update).not.toHaveBeenCalled();

    await page.type('field-hours', '2');
    await page.type('field-minutes', '3');
    await page.submit();

    expect(page.api.update).toHaveBeenCalledWith('p1', { version: 3, name: 'Otra' });
  });

  it('goes back to the list without a request when nothing changed', async () => {
    const page = await renderEditing();

    await page.submit();

    expect(page.api.update).not.toHaveBeenCalled();
    expect(page.navigate).toHaveBeenCalledWith(['/piezas']);
  });

  it('goes to the list with a success message when the changes are saved', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro');
    await page.submit();

    page.saves[0]?.next(makePart({ name: 'Otro', version: 4 }));
    await page.fixture.whenStable();

    expect(page.navigate).toHaveBeenCalledWith(['/piezas'], { state: { notice: 'updated' } });
  });

  it('sends one request for a double click on Guardar', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro');
    const submit = page.button('Guardar');

    submit?.click();
    submit?.click();
    await page.fixture.whenStable();

    expect(page.api.update).toHaveBeenCalledTimes(1);
    expect(page.button('Guardando…')?.disabled).toBe(true);
  });

  describe('re-importing a G-code file', () => {
    it('sends the source on its own even when nothing else changed', async () => {
      const page = await renderEditing();
      await page.importCura(
        makeAnalysis({
          estimatedPrintSeconds: 7380,
          filamentGrams: 25,
          layerHeightUm: 200,
          dimensionsMm: { x: 40, y: 30, z: 20 },
          targetMachineName: 'Ender 3',
        }),
        'nuevo.gcode',
      );

      await page.submit();

      expect(page.api.update).toHaveBeenCalledExactlyOnceWith('p1', {
        version: 3,
        source: { kind: 'gcode', fileName: 'nuevo.gcode', slicer: 'cura' },
      });
    });

    it('sends the imported values that differ together with the source', async () => {
      const page = await renderEditing();
      await page.importCura(makeAnalysis(), 'nuevo.gcode');

      await page.submit();

      expect(page.api.update).toHaveBeenCalledExactlyOnceWith('p1', {
        version: 3,
        dimensionsMm: { x: 61, y: 52, z: 33 },
        estimatedWeightGrams: 24,
        estimatedPrintSeconds: 5025,
        layerHeightUm: 160,
        suggestedPrinterName: 'Creality Ender-3',
        source: { kind: 'gcode', fileName: 'nuevo.gcode', slicer: 'cura' },
      });
    });

    it('does not send a source when no file was imported', async () => {
      const page = await renderEditing(
        makePart({
          source: { kind: 'gcode', fileName: 'viejo.gcode', slicer: 'cura', analyzedAt: 'x' },
        }),
      );
      await page.type('field-name', 'Otro');

      await page.submit();

      const body = page.api.update.mock.calls[0]?.[1] as object;
      expect('source' in body).toBe(false);
    });
  });

  describe('conflicts', () => {
    it('tells the user someone else changed the part when the version is stale', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'version', message: 'stale' }]));

      const alert = page.element.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Alguien modificó esta pieza');
      expect(page.button('Recargar')).toBeDefined();
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });

    it('reloads the part, with its new version, when Recargar is pressed', async () => {
      const page = await renderEditing();
      await page.type('field-name', 'Mi cambio');
      await page.submit();
      await page.rejectSave(problem(409, [{ path: 'version', message: 'stale' }]));

      page.button('Recargar')?.click();
      await page.fixture.whenStable();
      expect(page.api.get).toHaveBeenCalledTimes(2);
      await page.loadPart(makePart({ name: 'Del otro', estimatedWeightGrams: 33, version: 4 }));
      await page.type('field-description', 'Nueva');
      await page.submit();

      expect(page.byId('field-name')?.value).toBe('Del otro');
      expect(page.byId('field-weight')?.value).toBe('33');
      expect(page.api.update).toHaveBeenLastCalledWith('p1', { version: 4, description: 'Nueva' });
    });
  });

  it('leaves for the list with a message when the part vanished before saving', async () => {
    const page = await renderEditing();
    await page.type('field-name', 'Otro');
    await page.submit();

    await page.rejectSave(problem(404));

    expect(page.navigate).toHaveBeenCalledWith(['/piezas'], { state: { notice: 'gone' } });
  });

  it('says the part no longer exists when loading it answers 404', async () => {
    const page = await render({ editing: true });

    page.gets[0]?.error(problem(404));
    await page.fixture.whenStable();

    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'La pieza ya no existe.',
    );
    expect(page.element.querySelector('form')).toBeNull();
    expect(page.element.querySelector('a[href="/piezas"]')).not.toBeNull();
  });

  it('shows a safe error with a retry when loading fails, and retries', async () => {
    const page = await render({ editing: true });
    page.gets[0]?.error(problem(500));
    await page.fixture.whenStable();
    expect(page.text()).toContain('Mensaje seguro en español.');
    expect(page.element.innerHTML).not.toContain(SENTINEL);

    page.button('Reintentar')?.click();
    await page.fixture.whenStable();
    await page.loadPart(makePart());

    expect(page.api.get).toHaveBeenCalledTimes(2);
    expect(page.byId('field-name')?.value).toBe('Soporte de cable');
  });
});
