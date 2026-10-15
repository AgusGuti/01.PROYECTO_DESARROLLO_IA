import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type {
  CostSettings,
  Material,
  ProjectCostEstimate,
  ProjectCostEstimateRequest,
} from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { CostsApi } from './costs-api';
import {
  type PickerCatalogue,
  type PickerFilament,
  type PickerPrinter,
  type PickerProject,
  CostsPickersApi,
} from './costs-pickers-api';
import { formatDuration, ProjectCostPage } from './project-cost-page';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

/** A deleted part first, then PETG x3 (form line 0) and PLA x1 (form line 1). */
const PROJECT: PickerProject = {
  id: 'proj-1',
  name: 'Soportes del taller',
  items: [
    { partId: 'gone', quantity: 2, part: null },
    { partId: 'part-1', quantity: 3, part: { name: 'Soporte de cable', material: 'PETG' } },
    { partId: 'part-2', quantity: 1, part: { name: 'Tapa', material: 'PLA' } },
  ],
};

function spool(overrides: Partial<PickerFilament> = {}): PickerFilament {
  return {
    id: 'spool-1',
    brand: 'Grilon3',
    colorName: 'Negro',
    material: 'PETG',
    availableGrams: 1000,
    ...overrides,
  };
}

const PLA_SPOOL = spool({ id: 'spool-pla', material: 'PLA', colorName: 'Blanco' });
const PRINTER: PickerPrinter = { id: 'printer-1', name: 'Ender 3 Pro', powerWatts: 270 };

const SETTINGS: CostSettings = {
  kwhPriceMinor: 8000,
  wearPerHourMinor: 150,
  fixedPerJobMinor: 5000,
  defaultMarginBasisPoints: 2500,
  version: 2,
  updatedAt: '2026-10-15T12:00:00.000Z',
};

function line(partId: string, subtotalMinor: number, marginMinor: number, margin = 0) {
  return {
    partId,
    quantity: 1,
    printSeconds: 3600,
    filament: { grams: 100, costMinor: subtotalMinor - 150 },
    electricity: null,
    wear: { costMinor: 150 },
    subtotalMinor,
    marginBasisPoints: margin,
    marginMinor,
    totalMinor: subtotalMinor + marginMinor,
    unitTotalMinor: subtotalMinor + marginMinor,
    warnings: [],
  };
}

/** Line 0: 1.000,00 without margin. Line 1: 2.000,00 plus 25 % (500,00). Fixed 50,00 once. */
const ESTIMATE: ProjectCostEstimate = {
  lines: [line('part-1', 100_000, 0), line('part-2', 200_000, 50_000, 2500)],
  fixed: { costMinor: 5000 },
  subtotalMinor: 305_000,
  marginMinor: 50_000,
  totalMinor: 355_000,
  printSeconds: 9000,
  materials: [
    { material: 'PETG', grams: 300 },
    { material: 'PLA', grams: 100 },
  ],
  warnings: [],
};

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

const catalogue = <T>(items: T[], truncated = false): PickerCatalogue<T> => ({ items, truncated });

/** Intl puts no-break spaces in the amounts; the tests compare with plain ones. */
const plain = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

async function render(options: { id?: string | null } = {}) {
  const projectReplies: Subject<PickerProject>[] = [];
  const printersReplies: Subject<PickerCatalogue<PickerPrinter>>[] = [];
  const spoolRequests: { material: Material; reply: Subject<PickerCatalogue<PickerFilament>> }[] =
    [];
  const settingsReplies: Subject<CostSettings>[] = [];
  const estimates: { body: ProjectCostEstimateRequest; reply: Subject<ProjectCostEstimate> }[] = [];

  const pickers = {
    project: vi.fn((_id: string) => {
      const reply = new Subject<PickerProject>();
      projectReplies.push(reply);
      return reply;
    }),
    printers: vi.fn(() => {
      const reply = new Subject<PickerCatalogue<PickerPrinter>>();
      printersReplies.push(reply);
      return reply;
    }),
    filaments: vi.fn((material: Material) => {
      const reply = new Subject<PickerCatalogue<PickerFilament>>();
      spoolRequests.push({ material, reply });
      return reply;
    }),
  };
  const api = {
    getSettings: vi.fn(() => {
      const reply = new Subject<CostSettings>();
      settingsReplies.push(reply);
      return reply;
    }),
    estimateProject: vi.fn((body: ProjectCostEstimateRequest) => {
      const reply = new Subject<ProjectCostEstimate>();
      estimates.push({ body, reply });
      return reply;
    }),
  };
  const id = options.id === undefined ? 'proj-1' : options.id;
  TestBed.configureTestingModule({
    imports: [ProjectCostPage],
    providers: [
      provideRouter([]),
      { provide: CostsApi, useValue: api },
      { provide: CostsPickersApi, useValue: pickers },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap(id === null ? {} : { id }) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(ProjectCostPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const last = <T>(list: T[]): T | undefined => list[list.length - 1];

  const view = {
    fixture,
    element,
    api,
    pickers,
    projectReplies,
    printersReplies,
    estimates,
    spoolRequests,
    text: () => plain(element.textContent),
    byId: (elementId: string) => element.querySelector<HTMLElement>(`#${elementId}`),
    input: (elementId: string) => element.querySelector<HTMLInputElement>(`#${elementId}`),
    select: (elementId: string) => element.querySelector<HTMLSelectElement>(`#${elementId}`),
    optionTexts: (elementId: string) =>
      Array.from(element.querySelectorAll<HTMLOptionElement>(`#${elementId} option`)).map(
        (option) => plain(option.textContent),
      ),
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    alertText: () => plain(element.querySelector('[role="alert"]')?.textContent),
    result: () => element.querySelector('.result'),
    async loadProject(project: PickerProject = PROJECT) {
      last(projectReplies)?.next(project);
      await settle();
    },
    async loadPrinters(items: PickerPrinter[] = [PRINTER]) {
      last(printersReplies)?.next(catalogue(items));
      await settle();
    },
    async loadSettings(settings: CostSettings = SETTINGS) {
      last(settingsReplies)?.next(settings);
      await settle();
    },
    async loadSpools(material: Material, items: PickerFilament[], truncated = false) {
      spoolRequests
        .find((request) => request.material === material)
        ?.reply.next(catalogue(items, truncated));
      await settle();
    },
    async choose(elementId: string, value: string) {
      const control = view.select(elementId);
      if (control) {
        control.value = value;
        control.dispatchEvent(new Event('change'));
      }
      await settle();
    },
    async type(elementId: string, value: string) {
      const control = view.input(elementId);
      if (control) {
        control.value = value;
        control.dispatchEvent(new Event('input'));
      }
      await settle();
    },
    async check(elementId: string, checked: boolean) {
      const box = view.input(elementId);
      if (box) {
        box.checked = checked;
        box.dispatchEvent(new Event('change'));
      }
      await settle();
    },
    /** Pressing Enter in a field submits the form: this is what a keyboard user does. */
    async submit() {
      element.querySelector('form')?.dispatchEvent(new Event('submit'));
      await settle();
    },
    async answer(estimate: ProjectCostEstimate) {
      last(estimates)?.reply.next(estimate);
      await settle();
    },
    async fail(error: unknown) {
      last(estimates)?.reply.error(error);
      await settle();
    },
    /** Everything loaded and both spools chosen (one spool per material is preselected). */
    async ready() {
      await view.loadProject();
      await view.loadPrinters();
      await view.loadSettings();
      await view.loadSpools('PETG', [spool()]);
      await view.loadSpools('PLA', [PLA_SPOOL]);
    },
  };
  return view;
}

describe('ProjectCostPage', () => {
  describe('loading the project', () => {
    it('has one h1 and announces that the project is loading', async () => {
      const page = await render();

      expect(page.element.querySelectorAll('h1')).toHaveLength(1);
      expect(page.element.querySelector('h1')?.textContent).toBe('Costo del proyecto');
      expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
        'Cargando el proyecto',
      );
      expect(page.pickers.project).toHaveBeenCalledExactlyOnceWith('proj-1');
    });

    it('shows a safe message and retries when the project cannot be loaded', async () => {
      const page = await render();

      page.projectReplies[0]?.error(problem(503));
      await page.fixture.whenStable();
      page.fixture.detectChanges();
      expect(page.alertText()).toContain('Mensaje seguro en español.');
      expect(page.text()).not.toContain(SENTINEL);

      page.button('Reintentar')?.click();
      await page.fixture.whenStable();
      expect(page.pickers.project).toHaveBeenCalledTimes(2);
    });

    it('fails with a generic message when the route has no id', async () => {
      const page = await render({ id: null });

      expect(page.alertText()).toContain('Ocurrió un error inesperado');
      expect(page.pickers.project).not.toHaveBeenCalled();
    });

    it('explains an empty project and links to edit it', async () => {
      const page = await render();

      await page.loadProject({ ...PROJECT, items: [] });

      expect(page.byId('project-empty')?.textContent).toContain('todavía no tiene piezas');
      expect(page.byId('project-empty')?.querySelector('a')?.getAttribute('href')).toBe(
        '/proyectos/proj-1/editar',
      );
      expect(page.element.querySelector('form')).toBeNull();
    });

    it('shows each live line with quantity and material, and a deleted line apart', async () => {
      const page = await render();

      await page.loadProject();

      const legends = Array.from(page.element.querySelectorAll('legend')).map((l) =>
        plain(l.textContent),
      );
      expect(legends).toEqual([
        'Pieza eliminada × 2',
        'Soporte de cable × 3 · PETG',
        'Tapa × 1 · PLA',
      ]);
      expect(page.byId('deleted-note')?.textContent).toContain('1 línea(s) con pieza eliminada');
      expect(page.input('line-0-sale')).not.toBeNull();
    });

    it('offers nothing to calculate when every part was deleted', async () => {
      const page = await render();

      await page.loadProject({
        ...PROJECT,
        items: [{ partId: 'gone', quantity: 1, part: null }],
      });

      expect(page.byId('nothing-to-calculate')?.textContent).toContain('No quedan piezas');
      expect(page.button('Calcular')).toBeUndefined();
    });
  });

  describe('spools', () => {
    it('reads the spools of each material once, even with several lines of the same material', async () => {
      const page = await render();

      await page.loadProject({
        ...PROJECT,
        items: [
          { partId: 'a', quantity: 1, part: { name: 'A', material: 'PETG' } },
          { partId: 'b', quantity: 1, part: { name: 'B', material: 'PETG' } },
        ],
      });

      expect(page.pickers.filaments).toHaveBeenCalledExactlyOnceWith('PETG');
    });

    it('lists the spools of the line material with grams and marks the empty one', async () => {
      const page = await render();
      await page.loadProject();
      expect(page.byId('line-0-spool-status')?.textContent).toContain('Cargando las bobinas');

      await page.loadSpools('PETG', [
        spool({ id: 'a' }),
        spool({ id: 'b', brand: 'Sunlu', colorName: 'Rojo', availableGrams: 0 }),
      ]);
      await page.loadSpools('PLA', [PLA_SPOOL]);

      expect(page.optionTexts('line-0-spool')).toEqual([
        'Elegí una bobina',
        'Grilon3 · Negro · 1.000 g disponibles',
        'Sunlu · Rojo · 0 g disponibles · Sin stock',
      ]);
      expect(page.select('line-0-spool')?.value).toBe('');
      expect(page.optionTexts('line-1-spool')[1]).toContain('Blanco');
    });

    it('preselects the only spool of a material', async () => {
      const page = await render();

      await page.ready();

      expect(page.select('line-0-spool')?.value).toBe('spool-1');
      expect(page.select('line-1-spool')?.value).toBe('spool-pla');
    });

    it('says when there are no spools of a material and links to add one', async () => {
      const page = await render();
      await page.loadProject();

      await page.loadSpools('PETG', []);

      expect(page.byId('line-0-spool-empty')?.textContent).toContain('No hay bobinas');
      expect(page.byId('line-0-spool-empty')?.querySelector('a')?.getAttribute('href')).toBe(
        '/filamentos/nuevo',
      );
      expect(page.select('line-0-spool')).toBeNull();
    });

    it('shows a safe message and retries when the spools cannot be loaded', async () => {
      const page = await render();
      await page.loadProject();

      page.spoolRequests[0]?.reply.error(problem(503));
      await page.fixture.whenStable();
      page.fixture.detectChanges();
      expect(page.alertText()).toContain('Mensaje seguro en español.');
      expect(page.text()).not.toContain(SENTINEL);

      page.button('Reintentar')?.click();
      await page.fixture.whenStable();
      expect(page.pickers.filaments).toHaveBeenCalledTimes(4);
    });
  });

  describe('printers and settings', () => {
    it('offers "no printer" first and then the printers on every line', async () => {
      const page = await render();
      await page.loadProject();

      await page.loadPrinters();

      const expected = ['Sin impresora (no se calcula electricidad)', 'Ender 3 Pro'];
      expect(page.optionTexts('line-0-printer')).toEqual(expected);
      expect(page.optionTexts('line-1-printer')).toEqual(expected);
    });

    it('shows a safe message when the printers fail and lets the user go on', async () => {
      const page = await render();
      await page.loadProject();

      page.printersReplies[0]?.error(problem(503));
      await page.fixture.whenStable();
      page.fixture.detectChanges();

      expect(page.byId('printers-failed')?.textContent).toContain('Mensaje seguro en español.');
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.optionTexts('line-0-printer')).toHaveLength(1);
    });
  });

  describe('sale and margin per line', () => {
    it('starts with "¿Venta?" unchecked and no margin field', async () => {
      const page = await render();

      await page.ready();

      expect(page.input('line-0-sale')?.checked).toBe(false);
      expect(page.element.querySelector('label[for="line-0-sale"]')?.textContent).toContain(
        '¿Venta?',
      );
      expect(page.input('line-0-margin')).toBeNull();
    });

    it('reveals a margin with a percent sign, prefilled from the settings, for that line only', async () => {
      const page = await render();
      await page.ready();

      await page.check('line-1-sale', true);

      expect(page.input('line-1-margin')?.value).toBe('25');
      expect(page.element.querySelector('.percent')?.textContent).toContain('%');
      expect(page.element.querySelector('label[for="line-1-margin"]')?.textContent).toBe('Margen');
      expect(page.input('line-0-margin')).toBeNull();
    });

    it('leaves the margin empty when the settings cannot be read', async () => {
      const page = await render();
      await page.loadProject();

      await page.check('line-0-sale', true);

      expect(page.input('line-0-margin')?.value).toBe('');
    });

    it('sends every live line with its own spool, printer and margin, and the project quantity', async () => {
      const page = await render();
      await page.ready();
      await page.choose('line-1-printer', PRINTER.id);
      await page.check('line-1-sale', true);
      await page.type('line-1-margin', '12,5');

      await page.submit();

      expect(page.api.estimateProject).toHaveBeenCalledExactlyOnceWith({
        lines: [
          { partId: 'part-1', filamentId: 'spool-1', quantity: 3 },
          {
            partId: 'part-2',
            filamentId: 'spool-pla',
            quantity: 1,
            printerId: 'printer-1',
            marginBasisPoints: 1250,
          },
        ],
      });
    });

    it('omits the margin again after the user unchecks "¿Venta?"', async () => {
      const page = await render();
      await page.ready();
      await page.check('line-0-sale', true);
      await page.check('line-0-sale', false);

      await page.submit();

      expect(page.estimates[0]?.body.lines[0]).not.toHaveProperty('marginBasisPoints');
    });

    it.each(['abc', '12,345', '-5', '1001', ''])(
      'rejects the margin %j without calling the API and focuses it',
      async (value) => {
        const page = await render();
        await page.ready();
        await page.check('line-1-sale', true);
        await page.type('line-1-margin', value);

        await page.submit();

        const field = page.input('line-1-margin');
        expect(field?.value).toBe(value);
        expect(field?.getAttribute('aria-invalid')).toBe('true');
        expect(field?.getAttribute('aria-describedby')).toBe('line-1-margin-error');
        expect(page.byId('line-1-margin-error')?.textContent).toContain('hasta 2 decimales');
        expect(page.api.estimateProject).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(field);
      },
    );

    it('does not validate the margin of a line that is not a sale', async () => {
      const page = await render();
      await page.ready();
      await page.check('line-0-sale', true);
      await page.type('line-0-margin', 'abc');
      await page.check('line-0-sale', false);

      await page.submit();

      expect(page.api.estimateProject).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation before sending', () => {
    it('asks for the missing spool of the second line and focuses it', async () => {
      const page = await render();
      await page.loadProject();
      await page.loadPrinters();
      await page.loadSpools('PETG', [spool()]);
      await page.loadSpools('PLA', [PLA_SPOOL, spool({ id: 'other', material: 'PLA' })]);

      await page.submit();

      expect(page.api.estimateProject).not.toHaveBeenCalled();
      expect(plain(page.byId('line-1-spool-error')?.textContent)).toBe('Elegí una bobina.');
      expect(page.select('line-1-spool')?.getAttribute('aria-invalid')).toBe('true');
      expect(page.select('line-1-spool')?.getAttribute('aria-describedby')).toBe(
        'line-1-spool-error',
      );
      expect(document.activeElement).toBe(page.select('line-1-spool'));
      expect(page.byId('line-0-spool-error')).toBeNull();
    });
  });

  describe('focus when the spool select is not rendered', () => {
    it('focuses the line title when its spool list is empty', async () => {
      const page = await render();
      await page.loadProject();
      await page.loadSpools('PETG', []);
      await page.loadSpools('PLA', [PLA_SPOOL]);

      await page.submit();

      expect(page.api.estimateProject).not.toHaveBeenCalled();
      expect(page.select('line-0-spool')).toBeNull();
      expect(document.activeElement).toBe(page.byId('line-0-title'));
    });

    it('focuses the placeholder select while its spools are still loading', async () => {
      const page = await render();
      await page.loadProject();

      await page.submit();

      expect(document.activeElement).toBe(page.select('line-0-spool'));
    });

    it('links the row error to the line title for screen readers', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(problem(400, [{ path: 'lines.0.quantity', message: SENTINEL }]));

      expect(page.byId('line-0-title')?.getAttribute('aria-describedby')).toBe('line-0-row-error');
      expect(page.byId('line-1-title')?.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('result', () => {
    it('shows one row per line, the fixed cost once and the totals that add up', async () => {
      const page = await render();
      await page.ready();
      await page.check('line-1-sale', true);
      await page.submit();

      await page.answer(ESTIMATE);

      const rows = Array.from(page.element.querySelectorAll('#lines-result tbody tr')).map((row) =>
        Array.from(row.children).map((cell) => plain(cell.textContent)),
      );
      expect(rows).toEqual([
        [
          'Soporte de cable × 1',
          '$ 998,50 (100 g)',
          '—',
          '$ 1,50',
          '$ 1.000,00',
          '—',
          '$ 1.000,00',
        ],
        [
          'Tapa × 1',
          '$ 1.998,50 (100 g)',
          '—',
          '$ 1,50',
          '$ 2.000,00',
          '$ 500,00 (25 %)',
          '$ 2.500,00',
        ],
      ]);
      const summary = Array.from(page.element.querySelectorAll('.summary tbody tr')).map((row) => [
        plain(row.querySelector('th')?.textContent),
        plain(row.querySelector('td')?.textContent),
      ]);
      expect(summary).toEqual([
        ['Costo fijo del proyecto (se cobra una vez y no lleva margen)', '$ 50,00'],
        ['Subtotal del proyecto', '$ 3.050,00'],
        ['Margen', '$ 500,00'],
        ['Total del proyecto', '$ 3.550,00'],
        ['Tiempo total de impresión', '2 h 30 min'],
      ]);
      expect(100_000 + 200_000 + 5000).toBe(ESTIMATE.subtotalMinor);
      expect(ESTIMATE.subtotalMinor + ESTIMATE.marginMinor).toBe(ESTIMATE.totalMinor);
    });

    it('shows the electricity of a line when it has any', async () => {
      const page = await render();
      await page.ready();
      await page.submit();
      const [first, second] = ESTIMATE.lines;

      await page.answer({
        ...ESTIMATE,
        lines: [
          ...(first ? [{ ...first, electricity: { watts: 270, costMinor: 8640 } }] : []),
          ...(second ? [second] : []),
        ],
      });

      const cells = page.element.querySelectorAll('#lines-result tbody tr:first-child td');
      expect(plain(cells[1]?.textContent)).toBe('$ 86,40');
    });

    it('lists the grams needed per material', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.answer(ESTIMATE);

      expect(page.element.querySelector('h3')?.textContent).toBe('Material necesario');
      const items = Array.from(page.element.querySelectorAll('.materials li')).map((li) =>
        plain(li.textContent),
      );
      expect(items).toEqual(['PETG: 300 g', 'PLA: 100 g']);
    });

    it('says inside the result that the total excludes deleted-part lines', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.answer(ESTIMATE);

      expect(page.result()?.querySelector('#total-excludes-deleted')?.textContent).toContain(
        'El total no incluye 1 línea(s) con pieza eliminada',
      );
    });

    it('does not mention deleted lines when there are none', async () => {
      const page = await render();
      await page.loadProject({ ...PROJECT, items: PROJECT.items.slice(1) });
      await page.loadPrinters();
      await page.loadSpools('PETG', [spool()]);
      await page.loadSpools('PLA', [PLA_SPOOL]);
      await page.submit();

      await page.answer(ESTIMATE);

      expect(page.byId('total-excludes-deleted')).toBeNull();
    });

    it('renders the result inside a polite live region', async () => {
      const page = await render();
      await page.ready();
      await page.submit();
      expect(page.result()?.getAttribute('aria-live')).toBe('polite');

      await page.answer(ESTIMATE);

      expect(page.result()?.querySelector('table')).not.toBeNull();
      expect(page.result()?.textContent).toContain('Resultado');
    });

    it('clears the previous result as soon as an input changes', async () => {
      const page = await render();
      await page.ready();
      await page.submit();
      await page.answer(ESTIMATE);
      expect(page.result()?.querySelector('table')).not.toBeNull();

      await page.choose('line-0-printer', PRINTER.id);

      expect(page.result()?.querySelector('table')).toBeNull();
    });

    it('drops the answer of a request in flight when an input changes', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.check('line-1-sale', true);
      await page.answer(ESTIMATE);

      expect(page.result()?.querySelector('table')).toBeNull();
      expect(page.button('Calcular')?.disabled).toBe(false);
    });

    it('fails safely when the answer has a different number of lines than the request', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.answer({ ...ESTIMATE, lines: [] });

      expect(page.alertText()).toContain('algo inesperado');
      expect(page.result()?.querySelector('table')).toBeNull();
    });
  });

  describe('warnings', () => {
    it.each([
      ['filament_insufficient', 'La bobina elegida no alcanza para todas las líneas'],
      ['electricity_printer_not_selected', 'En alguna línea no elegiste impresora'],
      ['electricity_printer_power_unknown', 'Alguna impresora no tiene cargada su potencia'],
      ['settings_not_configured', 'Todavía no guardaste tus tarifas'],
    ] as const)('explains %s in Spanish with a hidden icon beside the text', async (code, text) => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.answer({ ...ESTIMATE, warnings: [{ code }] });

      const item = page.element.querySelector('.warnings li');
      expect(item?.textContent).toContain(text);
      expect(item?.querySelector('[aria-hidden="true"]')?.textContent).toBe('⚠');
      expect(page.text()).not.toContain(code);
    });

    it('links to the settings only for settings_not_configured', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.answer({
        ...ESTIMATE,
        warnings: [{ code: 'settings_not_configured' }, { code: 'filament_insufficient' }],
      });

      const links = page.element.querySelectorAll('.warnings a');
      expect(links).toHaveLength(1);
      expect(links[0]?.getAttribute('href')).toBe('/costos/ajustes');
    });
  });

  describe('errors and double submission', () => {
    it('disables the button while calculating and sends one request however often it is pressed', async () => {
      const page = await render();
      await page.ready();

      await page.submit();
      await page.submit();
      page.button('Calculando…')?.click();
      await page.fixture.whenStable();

      expect(page.api.estimateProject).toHaveBeenCalledTimes(1);
      expect(page.element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        true,
      );
    });

    it('maps each 400 issue to the right line and field, skipping the deleted line', async () => {
      const page = await render();
      await page.ready();
      await page.choose('line-0-printer', PRINTER.id);
      await page.submit();

      await page.fail(
        problem(400, [
          { path: 'lines.1.filamentId', message: SENTINEL },
          { path: 'lines.0.printerId', message: SENTINEL },
          { path: 'lines.0.quantity', message: SENTINEL },
          { path: 'lines.1.partId', message: SENTINEL },
        ]),
      );

      expect(page.byId('line-0-printer-error')?.textContent).toContain('ya no existe');
      expect(page.byId('line-0-row-error')?.textContent).toContain('demasiado grande');
      expect(page.byId('line-1-spool-error')?.textContent).toContain('material no coincide');
      expect(page.byId('line-1-row-error')?.textContent).toContain('ya no existe');
      expect(page.byId('line-0-spool-error')).toBeNull();
      expect(page.alertText()).toContain('Revisá');
      expect(page.text()).not.toContain(SENTINEL);
      expect(document.activeElement).toBe(page.byId('line-0-title'));
      expect(page.button('Calcular')?.disabled).toBe(false);
    });

    it('focuses the first field with a server error when no line was rejected as a whole', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(problem(400, [{ path: 'lines.1.filamentId', message: SENTINEL }]));

      expect(document.activeElement).toBe(page.select('line-1-spool'));
    });

    it('clears a server error when the user changes the field', async () => {
      const page = await render();
      await page.ready();
      await page.submit();
      await page.fail(problem(400, [{ path: 'lines.1.filamentId', message: SENTINEL }]));

      await page.choose('line-1-spool', 'spool-pla');

      expect(page.byId('line-1-spool-error')).toBeNull();
    });

    it('says the total is too large when only the sum overflows (path lines)', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(problem(400, [{ path: 'lines', message: SENTINEL }]));

      expect(page.alertText()).toContain('El total del proyecto es demasiado grande');
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('ignores an issue for a line that does not exist and shows the safe message', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(problem(400, [{ path: 'lines.9.filamentId', message: SENTINEL }]));

      expect(page.alertText()).toContain('Mensaje seguro en español.');
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('shows the safe message for a 503, never the backend text, and does not retry', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(problem(503));

      expect(page.alertText()).toContain('Mensaje seguro en español.');
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.api.estimateProject).toHaveBeenCalledTimes(1);
      expect(page.button('Calcular')?.disabled).toBe(false);
    });

    it('shows a generic message when the error is not an ApiError', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(new Error(SENTINEL));

      expect(page.alertText()).toContain('Ocurrió un error inesperado');
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('lets the user calculate again after a failure', async () => {
      const page = await render();
      await page.ready();
      await page.submit();
      await page.fail(problem(503));

      await page.submit();
      await page.answer(ESTIMATE);

      expect(page.api.estimateProject).toHaveBeenCalledTimes(2);
      expect(page.result()?.querySelector('table')).not.toBeNull();
      expect(page.element.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('accessibility and safety', () => {
    it('gives every control of every line a label', async () => {
      const page = await render();
      await page.ready();
      await page.check('line-0-sale', true);
      await page.check('line-1-sale', true);

      for (const line of [0, 1]) {
        for (const field of ['spool', 'printer', 'sale', 'margin']) {
          const id = `line-${String(line)}-${field}`;
          expect(page.element.querySelector(`label[for="${id}"]`), id).not.toBeNull();
        }
      }
    });

    it('groups each line in a fieldset named after its part', async () => {
      const page = await render();
      await page.ready();

      expect(page.element.querySelectorAll('fieldset')).toHaveLength(3);
    });

    it('can be completed with the keyboard alone: preselected spools, then Enter', async () => {
      const page = await render();
      await page.ready();

      await page.submit();

      expect(page.estimates[0]?.body.lines).toHaveLength(2);
    });

    it('renders hostile names as plain text', async () => {
      const page = await render();
      const hostile = '<img src=x onerror=alert(1)>';

      await page.loadProject({
        ...PROJECT,
        items: [{ partId: 'h', quantity: 1, part: { name: hostile, material: 'PETG' } }],
      });
      await page.loadSpools('PETG', [spool({ id: 'a', brand: hostile }), spool({ id: 'b' })]);

      expect(page.element.querySelector('img')).toBeNull();
      expect(page.element.querySelector('legend')?.textContent).toContain(hostile);
      expect(page.optionTexts('line-0-spool')[1]).toContain(hostile);
    });
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [90, '2 min'],
    [3600, '1 h'],
    [9000, '2 h 30 min'],
  ])('formats %i seconds as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
