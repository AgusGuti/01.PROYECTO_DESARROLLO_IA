import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type {
  CostEstimate,
  CostEstimateRequest,
  CostSettings,
  Material,
} from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { CostEstimatePage } from './cost-estimate-page';
import { CostsApi } from './costs-api';
import {
  type PickerCatalogue,
  type PickerFilament,
  type PickerPart,
  type PickerPrinter,
  CostsPickersApi,
} from './costs-pickers-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

const PART: PickerPart = { id: 'part-1', name: 'Soporte de cable', material: 'PETG' };
const OTHER_PART: PickerPart = { id: 'part-2', name: 'Tapa', material: 'PLA' };

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

const PRINTER: PickerPrinter = { id: 'printer-1', name: 'Ender 3 Pro', powerWatts: 270 };

const SETTINGS: CostSettings = {
  kwhPriceMinor: 8000,
  wearPerHourMinor: 150,
  fixedPerJobMinor: 5000,
  defaultMarginBasisPoints: 2500,
  version: 2,
  updatedAt: '2026-10-15T12:00:00.000Z',
};

/** The worked example: 100 g / 7200 s, quantity 2, a 270 W printer. */
const ESTIMATE: CostEstimate = {
  quantity: 2,
  printSeconds: 14_400,
  filament: { grams: 200, costMinor: 400_000 },
  electricity: { watts: 270, costMinor: 8640 },
  wear: { costMinor: 600 },
  fixed: { costMinor: 5000 },
  subtotalMinor: 414_240,
  marginBasisPoints: 2500,
  marginMinor: 103_560,
  totalMinor: 517_800,
  unitTotalMinor: 258_900,
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

async function render(options: { piezaId?: string } = {}) {
  const partsReplies: Subject<PickerCatalogue<PickerPart>>[] = [];
  const printersReplies: Subject<PickerCatalogue<PickerPrinter>>[] = [];
  const spoolRequests: { material: Material; reply: Subject<PickerCatalogue<PickerFilament>> }[] =
    [];
  const settingsReplies: Subject<CostSettings>[] = [];
  const estimates: { body: CostEstimateRequest; reply: Subject<CostEstimate> }[] = [];

  const pickers = {
    parts: vi.fn(() => {
      const reply = new Subject<PickerCatalogue<PickerPart>>();
      partsReplies.push(reply);
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
    estimate: vi.fn((body: CostEstimateRequest) => {
      const reply = new Subject<CostEstimate>();
      estimates.push({ body, reply });
      return reply;
    }),
  };
  const query = options.piezaId === undefined ? {} : { piezaId: options.piezaId };
  TestBed.configureTestingModule({
    imports: [CostEstimatePage],
    providers: [
      provideRouter([]),
      { provide: CostsApi, useValue: api },
      { provide: CostsPickersApi, useValue: pickers },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(CostEstimatePage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const view = {
    fixture,
    element,
    api,
    pickers,
    partsReplies,
    printersReplies,
    estimates,
    spoolRequests,
    text: () => plain(element.textContent),
    byId: (id: string) => element.querySelector<HTMLElement>(`#${id}`),
    input: (id: string) => element.querySelector<HTMLInputElement>(`#${id}`),
    select: (id: string) => element.querySelector<HTMLSelectElement>(`#${id}`),
    optionTexts: (id: string) =>
      Array.from(element.querySelectorAll<HTMLOptionElement>(`#${id} option`)).map((option) =>
        plain(option.textContent),
      ),
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    result: () => element.querySelector('.result'),
    rows: () =>
      Array.from(element.querySelectorAll('.result tbody tr')).map((row) => [
        plain(row.querySelector('th')?.textContent),
        plain(row.querySelector('td')?.textContent),
      ]),
    async loadParts(items: PickerPart[] = [PART, OTHER_PART], truncated = false) {
      partsReplies[partsReplies.length - 1]?.next(catalogue(items, truncated));
      await settle();
    },
    async loadPrinters(items: PickerPrinter[] = [PRINTER], truncated = false) {
      printersReplies[printersReplies.length - 1]?.next(catalogue(items, truncated));
      await settle();
    },
    async loadSettings(settings: CostSettings = SETTINGS) {
      settingsReplies[settingsReplies.length - 1]?.next(settings);
      await settle();
    },
    async loadSpools(items: PickerFilament[], truncated = false) {
      spoolRequests[spoolRequests.length - 1]?.reply.next(catalogue(items, truncated));
      await settle();
    },
    async choose(id: string, value: string) {
      const control = view.select(id);
      if (control) {
        control.value = value;
        control.dispatchEvent(new Event('change'));
      }
      await settle();
    },
    async type(id: string, value: string) {
      const control = view.input(id);
      if (control) {
        control.value = value;
        control.dispatchEvent(new Event('input'));
      }
      await settle();
    },
    async check(checked: boolean) {
      const box = view.input('field-sale');
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
    async answer(estimate: CostEstimate) {
      estimates[estimates.length - 1]?.reply.next(estimate);
      await settle();
    },
    async fail(error: unknown) {
      estimates[estimates.length - 1]?.reply.error(error);
      await settle();
    },
    /** A page ready to calculate: part, one spool (preselected) and the printers loaded. */
    async ready(options: { sale?: boolean } = {}) {
      await view.loadParts();
      await view.loadPrinters();
      await view.loadSettings();
      await view.choose('field-part', PART.id);
      await view.loadSpools([spool()]);
      if (options.sale === true) await view.check(true);
    },
  };
  return view;
}

describe('CostEstimatePage', () => {
  describe('loading the choices', () => {
    it('has one h1 and announces that the parts are loading', async () => {
      const page = await render();

      expect(page.element.querySelectorAll('h1')).toHaveLength(1);
      expect(page.element.querySelector('h1')?.textContent).toBe('Calcular costo');
      expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
        'Cargando las piezas',
      );
    });

    it('offers each part with its material in Spanish', async () => {
      const page = await render();

      await page.loadParts([{ id: 'x', name: 'Soporte', material: 'PA_CF' }]);

      expect(page.optionTexts('field-part')).toEqual([
        'Elegí una pieza',
        'Soporte · Nailon con fibra de carbono (PA-CF)',
      ]);
      expect(page.element.querySelector('label[for="field-part"]')?.textContent).toBe('Pieza');
    });

    it('invites the user to add a part when there are none', async () => {
      const page = await render();

      await page.loadParts([]);

      expect(page.text()).toContain('Todavía no registraste piezas');
      expect(page.element.querySelector('a[href="/piezas/nueva"]')).not.toBeNull();
      expect(page.element.querySelector('form')).toBeNull();
    });

    it('shows a safe message and retries when the parts cannot be loaded', async () => {
      const page = await render();

      page.partsReplies[0]?.error(problem(503));
      await page.fixture.whenStable();
      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.text()).not.toContain(SENTINEL);

      page.button('Reintentar')?.click();
      await page.fixture.whenStable();
      expect(page.pickers.parts).toHaveBeenCalledTimes(2);
    });

    it('says when the list of parts was cut at the cap', async () => {
      const page = await render();

      await page.loadParts([PART], true);

      expect(page.byId('part-cap')?.textContent).toContain('solo las primeras 1 piezas');
      expect(page.select('field-part')?.getAttribute('aria-describedby')).toBe('part-cap');
    });

    it('preselects the part named in the piezaId query parameter', async () => {
      const page = await render({ piezaId: OTHER_PART.id });

      await page.loadParts();

      expect(page.select('field-part')?.value).toBe(OTHER_PART.id);
      expect(page.spoolRequests.map((request) => request.material)).toEqual(['PLA']);
    });

    it('ignores a piezaId that is not in the catalogue', async () => {
      const page = await render({ piezaId: 'does-not-exist' });

      await page.loadParts();

      expect(page.select('field-part')?.value).toBe('');
      expect(page.spoolRequests).toHaveLength(0);
    });
  });

  describe('spools', () => {
    it('loads the spools of the part material only when a part is chosen', async () => {
      const page = await render();
      await page.loadParts();
      expect(page.pickers.filaments).not.toHaveBeenCalled();
      expect(page.optionTexts('field-spool')).toEqual(['Elegí primero una pieza']);

      await page.choose('field-part', PART.id);

      expect(page.pickers.filaments).toHaveBeenCalledExactlyOnceWith('PETG');
      expect(page.byId('spool-status')?.textContent).toContain('Cargando las bobinas');
    });

    it('lists each spool with brand, colour and grams and marks the empty one', async () => {
      const page = await render();
      await page.loadParts();
      await page.choose('field-part', PART.id);

      await page.loadSpools([
        spool({ id: 'a', brand: 'Grilon3', colorName: 'Negro', availableGrams: 1000 }),
        spool({ id: 'b', brand: 'Sunlu', colorName: 'Rojo', availableGrams: 0 }),
      ]);

      expect(page.optionTexts('field-spool')).toEqual([
        'Elegí una bobina',
        'Grilon3 · Negro · 1.000 g disponibles',
        'Sunlu · Rojo · 0 g disponibles · Sin stock',
      ]);
      expect(page.select('field-spool')?.value).toBe('');
    });

    it('preselects the spool when there is exactly one', async () => {
      const page = await render();
      await page.loadParts();
      await page.choose('field-part', PART.id);

      await page.loadSpools([spool({ id: 'only' })]);

      expect(page.select('field-spool')?.value).toBe('only');
    });

    it('tells the user there are no spools of this material and links to add one', async () => {
      const page = await render();
      await page.loadParts();
      await page.choose('field-part', PART.id);

      await page.loadSpools([]);

      expect(page.byId('spool-empty')?.textContent).toContain('No hay bobinas de este material');
      expect(page.byId('spool-empty')?.querySelector('a')?.getAttribute('href')).toBe(
        '/filamentos/nuevo',
      );
      expect(page.select('field-spool')).toBeNull();
    });

    it('reloads the spools and clears the choice when another material is picked', async () => {
      const page = await render();
      await page.loadParts();
      await page.choose('field-part', PART.id);
      await page.loadSpools([spool({ id: 'only' })]);

      await page.choose('field-part', OTHER_PART.id);

      expect(page.spoolRequests.map((request) => request.material)).toEqual(['PETG', 'PLA']);
      await page.loadSpools([spool({ id: 'a' }), spool({ id: 'b' })]);
      expect(page.select('field-spool')?.value).toBe('');
    });

    it('shows a safe message and retries when the spools cannot be loaded', async () => {
      const page = await render();
      await page.loadParts();
      await page.choose('field-part', PART.id);

      page.spoolRequests[0]?.reply.error(problem(503));
      await page.fixture.whenStable();
      expect(page.byId('spool-failed')?.textContent).toContain('Mensaje seguro en español.');
      expect(page.text()).not.toContain(SENTINEL);

      page.button('Reintentar')?.click();
      await page.fixture.whenStable();
      expect(page.pickers.filaments).toHaveBeenCalledTimes(2);
    });

    it('says when the spool list was cut at the cap', async () => {
      const page = await render();
      await page.loadParts();
      await page.choose('field-part', PART.id);

      await page.loadSpools([spool({ id: 'a' }), spool({ id: 'b' })], true);

      expect(page.byId('spool-cap')?.textContent).toContain('solo las primeras 2 bobinas');
    });
  });

  describe('printer', () => {
    it('offers "no printer" first and then the printers', async () => {
      const page = await render();
      await page.loadParts();

      await page.loadPrinters();

      expect(page.optionTexts('field-printer')).toEqual([
        'Sin impresora (no se calcula electricidad)',
        'Ender 3 Pro',
      ]);
    });

    it('shows a safe message when the printers cannot be loaded and lets the user go on', async () => {
      const page = await render();
      await page.loadParts();

      page.printersReplies[0]?.error(problem(503));
      await page.fixture.whenStable();

      expect(page.byId('printer-status')?.textContent).toContain('Mensaje seguro en español.');
      expect(page.optionTexts('field-printer')).toEqual([
        'Sin impresora (no se calcula electricidad)',
      ]);
    });
  });

  describe('sale and margin', () => {
    it('starts with "¿Venta?" unchecked and no margin field', async () => {
      const page = await render();

      await page.ready();

      expect(page.input('field-sale')?.checked).toBe(false);
      expect(page.element.querySelector('label[for="field-sale"]')?.textContent).toContain(
        '¿Venta?',
      );
      expect(page.input('field-margin')).toBeNull();
    });

    it('shows the margin with a percent sign, prefilled from the default margin of the settings', async () => {
      const page = await render();
      await page.ready();

      await page.check(true);

      expect(page.input('field-margin')?.value).toBe('25');
      expect(page.element.querySelector('.percent')?.textContent).toContain('%');
      expect(page.element.querySelector('label[for="field-margin"]')?.textContent).toBe('Margen');
    });

    it('leaves the margin empty when the settings cannot be read', async () => {
      const page = await render();
      await page.loadParts();
      await page.choose('field-part', PART.id);
      await page.loadSpools([spool()]);

      await page.check(true);

      expect(page.input('field-margin')?.value).toBe('');
    });

    it('omits marginBasisPoints from the request when it is not a sale', async () => {
      const page = await render();
      await page.ready();

      await page.submit();

      expect(page.api.estimate).toHaveBeenCalledExactlyOnceWith({
        partId: 'part-1',
        filamentId: 'spool-1',
        quantity: 1,
      });
      expect(page.estimates[0]?.body).not.toHaveProperty('marginBasisPoints');
    });

    it('sends 2500 basis points when it is a sale with the default margin', async () => {
      const page = await render();
      await page.ready({ sale: true });

      await page.submit();

      expect(page.estimates[0]?.body).toEqual({
        partId: 'part-1',
        filamentId: 'spool-1',
        quantity: 1,
        marginBasisPoints: 2500,
      });
    });

    it('omits the margin again after the user unchecks "¿Venta?"', async () => {
      const page = await render();
      await page.ready({ sale: true });
      await page.check(false);

      await page.submit();

      expect(page.estimates[0]?.body).not.toHaveProperty('marginBasisPoints');
    });

    it('sends the typed margin as basis points', async () => {
      const page = await render();
      await page.ready({ sale: true });
      await page.type('field-margin', '12,5');

      await page.submit();

      expect(page.estimates[0]?.body.marginBasisPoints).toBe(1250);
    });

    it.each(['abc', '12,345', '-5', '1001', ''])(
      'rejects the margin %j without changing what was typed or calling the API',
      async (value) => {
        const page = await render();
        await page.ready({ sale: true });
        await page.type('field-margin', value);

        await page.submit();

        const field = page.input('field-margin');
        expect(field?.value).toBe(value);
        expect(field?.getAttribute('aria-invalid')).toBe('true');
        expect(field?.getAttribute('aria-describedby')).toBe('margin-error');
        expect(page.byId('margin-error')?.textContent).toContain('hasta 2 decimales');
        expect(page.api.estimate).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(field);
      },
    );

    it('does not validate the margin when it is not a sale', async () => {
      const page = await render();
      await page.ready({ sale: true });
      await page.type('field-margin', 'abc');
      await page.check(false);

      await page.submit();

      expect(page.api.estimate).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation before sending', () => {
    it('asks for a part, focusing the first missing field', async () => {
      const page = await render();
      await page.loadParts();

      await page.submit();

      expect(page.api.estimate).not.toHaveBeenCalled();
      expect(page.byId('part-error')?.textContent).toBe('Elegí una pieza.');
      expect(page.select('field-part')?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(page.select('field-part'));
    });

    it.each(['0', '1001', '1.5', ''])('rejects a quantity of %j', async (value) => {
      const page = await render();
      await page.ready();
      await page.type('field-quantity', value);

      await page.submit();

      expect(page.api.estimate).not.toHaveBeenCalled();
      expect(page.byId('quantity-error')?.textContent).toContain('entre 1 y 1000');
      expect(document.activeElement).toBe(page.input('field-quantity'));
    });

    it.each(['1', '1000'])('accepts a quantity of %s', async (value) => {
      const page = await render();
      await page.ready();
      await page.type('field-quantity', value);

      await page.submit();

      expect(page.estimates[0]?.body.quantity).toBe(Number(value));
    });

    it('includes the printer only when one is chosen', async () => {
      const page = await render();
      await page.ready();
      await page.choose('field-printer', PRINTER.id);

      await page.submit();

      expect(page.estimates[0]?.body.printerId).toBe('printer-1');
    });
  });

  describe('result', () => {
    it('shows the worked example for a sale and its lines add up to the total', async () => {
      const page = await render();
      await page.ready({ sale: true });
      await page.choose('field-printer', PRINTER.id);
      await page.type('field-quantity', '2');
      await page.submit();

      await page.answer(ESTIMATE);

      expect(page.rows()).toEqual([
        ['Filamento (200 g)', '$ 4.000,00'],
        ['Electricidad (270 W)', '$ 86,40'],
        ['Desgaste', '$ 6,00'],
        ['Costo fijo', '$ 50,00'],
        ['Subtotal (costo)', '$ 4.142,40'],
        ['Margen (25 %)', '$ 1.035,60'],
        ['Total con margen', '$ 5.178,00'],
        ['Costo por unidad (promedio)', '$ 2.589,00'],
      ]);
      expect(400_000 + 8640 + 600 + 5000).toBe(ESTIMATE.subtotalMinor);
      expect(ESTIMATE.subtotalMinor + ESTIMATE.marginMinor).toBe(ESTIMATE.totalMinor);
    });

    it('shows only a total, with no margin row, when it is not a sale', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.answer({ ...ESTIMATE, marginBasisPoints: 0, marginMinor: 0, totalMinor: 414_240 });

      const labels = page.rows().map(([label]) => label);
      expect(labels).toContain('Total');
      expect(labels).not.toContain('Total con margen');
      expect(labels.some((label) => label?.startsWith('Margen'))).toBe(false);
      expect(page.rows().find(([label]) => label === 'Total')?.[1]).toBe('$ 4.142,40');
    });

    it('omits the electricity line when the estimate has none', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.answer({ ...ESTIMATE, electricity: null });

      expect(page.rows().some(([label]) => label?.startsWith('Electricidad'))).toBe(false);
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

      await page.type('field-quantity', '3');

      expect(page.result()?.querySelector('table')).toBeNull();
    });

    it('drops the answer of a request in flight when an input changes', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.type('field-quantity', '3');
      await page.answer(ESTIMATE);

      expect(page.result()?.querySelector('table')).toBeNull();
      expect(page.button('Calcular')?.disabled).toBe(false);
    });
  });

  describe('warnings', () => {
    it.each([
      ['filament_insufficient', 'no tiene gramos suficientes'],
      ['electricity_printer_not_selected', 'No elegiste una impresora'],
      ['electricity_printer_power_unknown', 'no tiene cargada su potencia'],
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

      expect(page.api.estimate).toHaveBeenCalledTimes(1);
      expect(page.element.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
        true,
      );
    });

    it('puts each 400 issue next to its field and focuses the first one', async () => {
      const page = await render();
      await page.ready({ sale: true });
      await page.choose('field-printer', PRINTER.id);
      await page.submit();

      await page.fail(
        problem(400, [
          { path: 'filamentId', message: SENTINEL },
          { path: 'printerId', message: SENTINEL },
          { path: 'quantity', message: SENTINEL },
          { path: 'marginBasisPoints', message: SENTINEL },
          { path: 'partId', message: SENTINEL },
        ]),
      );

      expect(page.byId('part-error')?.textContent).toBe(
        'La pieza elegida ya no existe o no es válida.',
      );
      expect(page.byId('quantity-error')?.textContent).toContain('demasiado grande');
      expect(page.byId('spool-error')?.textContent).toContain('material no coincide');
      expect(page.byId('printer-error')?.textContent).toContain('ya no existe');
      expect(page.byId('margin-error')?.textContent).toBe('El margen no es válido.');
      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain('Revisá');
      expect(page.text()).not.toContain(SENTINEL);
      expect(document.activeElement).toBe(page.select('field-part'));
      expect(page.button('Calcular')?.disabled).toBe(false);
    });

    it('shows the safe message for a 503, never the backend text, and does not retry', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(problem(503));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.api.estimate).toHaveBeenCalledTimes(1);
      expect(page.button('Calcular')?.disabled).toBe(false);
    });

    it('shows the safe message for a 400 without a known path', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(problem(400, [{ path: 'surprise', message: SENTINEL }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('shows a generic message when the error is not an ApiError', async () => {
      const page = await render();
      await page.ready();
      await page.submit();

      await page.fail(new Error(SENTINEL));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Ocurrió un error inesperado',
      );
      expect(page.text()).not.toContain(SENTINEL);
    });

    it('lets the user calculate again after a failure', async () => {
      const page = await render();
      await page.ready();
      await page.submit();
      await page.fail(problem(503));

      await page.submit();
      await page.answer(ESTIMATE);

      expect(page.api.estimate).toHaveBeenCalledTimes(2);
      expect(page.result()?.querySelector('table')).not.toBeNull();
      expect(page.element.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('accessibility and safety', () => {
    it('gives every control a label', async () => {
      const page = await render();
      await page.ready({ sale: true });

      for (const id of [
        'field-part',
        'field-quantity',
        'field-spool',
        'field-printer',
        'field-sale',
        'field-margin',
      ]) {
        expect(page.element.querySelector(`label[for="${id}"]`), id).not.toBeNull();
      }
    });

    it('can be completed with the keyboard alone: a preselected part, then Enter', async () => {
      const page = await render({ piezaId: PART.id });
      await page.loadParts();
      await page.loadPrinters();
      await page.loadSpools([spool()]);

      await page.submit();

      expect(page.estimates[0]?.body).toEqual({
        partId: 'part-1',
        filamentId: 'spool-1',
        quantity: 1,
      });
    });

    it('renders hostile part and brand names as plain text', async () => {
      const page = await render();
      const hostile = '<img src=x onerror=alert(1)>';
      await page.loadParts([{ id: 'h', name: hostile, material: 'PETG' }]);
      await page.choose('field-part', 'h');

      await page.loadSpools([spool({ id: 'a', brand: hostile }), spool({ id: 'b' })]);

      expect(page.element.querySelector('img')).toBeNull();
      expect(page.optionTexts('field-part')[1]).toContain(hostile);
      expect(page.optionTexts('field-spool')[1]).toContain(hostile);
    });
  });
});
