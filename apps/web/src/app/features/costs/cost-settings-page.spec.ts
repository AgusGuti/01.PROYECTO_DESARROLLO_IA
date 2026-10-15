import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CostSettings, UpdateCostSettingsRequest } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { CostSettingsPage } from './cost-settings-page';
import { CostsApi } from './costs-api';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

function makeSettings(overrides: Partial<CostSettings> = {}): CostSettings {
  return {
    kwhPriceMinor: 8000,
    wearPerHourMinor: 150,
    fixedPerJobMinor: 5000,
    defaultMarginBasisPoints: 2500,
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
  const gets: Subject<CostSettings>[] = [];
  const puts: Subject<CostSettings>[] = [];
  const api = {
    getSettings: vi.fn(() => {
      const reply = new Subject<CostSettings>();
      gets.push(reply);
      return reply;
    }),
    putSettings: vi.fn((_body: UpdateCostSettingsRequest) => {
      const reply = new Subject<CostSettings>();
      puts.push(reply);
      return reply;
    }),
  };
  TestBed.configureTestingModule({
    imports: [CostSettingsPage],
    providers: [provideRouter([]), { provide: CostsApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(CostSettingsPage);
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
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    live: () => element.querySelector('[aria-live="polite"]')?.textContent.trim() ?? '',
    async load(settings: CostSettings) {
      gets[gets.length - 1]?.next(settings);
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
    async submit() {
      view.button('Guardar')?.click();
      await fixture.whenStable();
    },
    async respond(settings: CostSettings) {
      puts[puts.length - 1]?.next(settings);
      await fixture.whenStable();
    },
    async rejectSave(error: unknown) {
      puts[puts.length - 1]?.error(error);
      await fixture.whenStable();
    },
  };
  return view;
}

describe('CostSettingsPage', () => {
  it('has one h1 and shows a loading message while waiting', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Ajustes de costos');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain('Cargando');
  });

  it('shows the four numbers as labelled fields in pesos and percent', async () => {
    const page = await render();

    await page.load(makeSettings({ kwhPriceMinor: 8050, defaultMarginBasisPoints: 1250 }));

    expect(page.element.querySelector('label[for="field-kwh"]')?.textContent).toBe(
      'Precio del kWh ($)',
    );
    expect(page.element.querySelector('label[for="field-wear"]')?.textContent).toBe(
      'Desgaste de la impresora por hora ($)',
    );
    expect(page.element.querySelector('label[for="field-fixed"]')?.textContent).toBe(
      'Costo fijo por trabajo ($)',
    );
    expect(page.element.querySelector('label[for="field-margin"]')?.textContent).toBe(
      'Margen por defecto (%)',
    );
    expect(page.input('field-kwh')?.value).toBe('80,50');
    expect(page.input('field-wear')?.value).toBe('1,50');
    expect(page.input('field-fixed')?.value).toBe('50');
    expect(page.input('field-margin')?.value).toBe('12,5');
    expect(page.text()).not.toContain('Todavía no guardaste tus tarifas');
  });

  it('tells the user the costs use zeros when the settings were never saved', async () => {
    const page = await render();

    await page.load(
      makeSettings({
        kwhPriceMinor: 0,
        wearPerHourMinor: 0,
        fixedPerJobMinor: 0,
        defaultMarginBasisPoints: 0,
        version: 0,
        updatedAt: null,
      }),
    );

    expect(page.text()).toContain(
      'Todavía no guardaste tus tarifas: los costos se calculan con ceros.',
    );
  });

  it('shows a safe message and retries the load when it fails', async () => {
    const page = await render();

    page.gets[0]?.error(problem(503));
    await page.fixture.whenStable();
    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'Mensaje seguro en español.',
    );
    expect(page.text()).not.toContain(SENTINEL);

    page.button('Reintentar')?.click();
    await page.fixture.whenStable();
    expect(page.api.getSettings).toHaveBeenCalledTimes(2);
  });

  it('saves the amounts as centavos and basis points with the loaded version', async () => {
    const page = await render();
    await page.load(makeSettings({ version: 3 }));
    await page.type('field-kwh', '81,5');
    await page.type('field-wear', '2');
    await page.type('field-fixed', '0,01');
    await page.type('field-margin', '12,5');

    await page.submit();

    expect(page.api.putSettings).toHaveBeenCalledExactlyOnceWith({
      kwhPriceMinor: 8150,
      wearPerHourMinor: 200,
      fixedPerJobMinor: 1,
      defaultMarginBasisPoints: 1250,
      version: 3,
    });
  });

  it('announces the save, and sends the new version on the next one', async () => {
    const page = await render();
    await page.load(makeSettings({ version: 3 }));
    await page.submit();

    await page.respond(makeSettings({ version: 4 }));

    expect(page.live()).toBe('Ajustes guardados.');
    await page.submit();
    expect(page.api.putSettings).toHaveBeenLastCalledWith(expect.objectContaining({ version: 4 }));
  });

  it('sends version 0 for the very first save and drops the never-saved notice after it', async () => {
    const page = await render();
    await page.load(makeSettings({ version: 0, updatedAt: null }));
    await page.submit();
    expect(page.api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ version: 0 }));

    await page.respond(makeSettings({ version: 1 }));

    expect(page.text()).not.toContain('Todavía no guardaste tus tarifas');
  });

  it('disables the button while saving and sends only one request', async () => {
    const page = await render();
    await page.load(makeSettings());

    await page.submit();
    const button = page.element.querySelector<HTMLButtonElement>('button[type="submit"]');
    button?.click();
    await page.fixture.whenStable();

    expect(button?.disabled).toBe(true);
    expect(button?.textContent.trim()).toBe('Guardando…');
    expect(page.api.putSettings).toHaveBeenCalledTimes(1);
  });

  describe('validation', () => {
    it.each(['', 'abc', '1,234', '-1', '10000000,01'])(
      'rejects %j as an amount, focuses the field and does not call the API',
      async (value) => {
        const page = await render();
        await page.load(makeSettings());
        await page.type('field-kwh', value);

        await page.submit();

        expect(page.api.putSettings).not.toHaveBeenCalled();
        const field = page.input('field-kwh');
        expect(field?.getAttribute('aria-invalid')).toBe('true');
        expect(field?.getAttribute('aria-describedby')).toBe('kwh-error');
        expect(page.element.querySelector('#kwh-error')?.textContent).toContain(
          'Ingresá un importe',
        );
        expect(document.activeElement).toBe(field);
      },
    );

    it.each(['', '1001', '12,345', 'abc'])('rejects %j as a margin', async (value) => {
      const page = await render();
      await page.load(makeSettings());
      await page.type('field-margin', value);

      await page.submit();

      expect(page.api.putSettings).not.toHaveBeenCalled();
      expect(page.element.querySelector('#margin-error')?.textContent).toContain('0 a 1000');
    });

    it('accepts a margin of exactly 1000 percent and an amount of 10.000.000 pesos', async () => {
      const page = await render();
      await page.load(makeSettings());
      await page.type('field-margin', '1000');
      await page.type('field-fixed', '10000000');

      await page.submit();

      expect(page.api.putSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultMarginBasisPoints: 100_000,
          fixedPerJobMinor: 1_000_000_000,
        }),
      );
    });
  });

  describe('save errors', () => {
    it('puts a 400 issue next to its field without showing backend text', async () => {
      const page = await render();
      await page.load(makeSettings());
      await page.submit();

      await page.rejectSave(problem(400, [{ path: 'wearPerHourMinor', message: SENTINEL }]));

      expect(page.element.querySelector('#wear-error')?.textContent).toBe(
        'El desgaste por hora no es válido.',
      );
      expect(page.input('field-wear')?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(page.input('field-wear'));
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('offers to reload after a stale version and loads the new version', async () => {
      const page = await render();
      await page.load(makeSettings({ version: 3 }));
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'version', message: SENTINEL }]));

      const alert = page.element.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Alguien modificó estas tarifas');
      expect(page.text()).not.toContain(SENTINEL);

      page.button('Recargar')?.click();
      await page.fixture.whenStable();
      expect(page.api.getSettings).toHaveBeenCalledTimes(2);
      await page.load(makeSettings({ version: 5, kwhPriceMinor: 9000 }));
      expect(page.input('field-kwh')?.value).toBe('90');
      expect(page.element.querySelector('[role="alert"]')).toBeNull();

      await page.submit();
      expect(page.api.putSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ version: 5 }),
      );
    });

    it('shows the safe message for a 503 and keeps what was typed', async () => {
      const page = await render();
      await page.load(makeSettings());
      await page.type('field-kwh', '77');
      await page.submit();

      await page.rejectSave(problem(503));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.input('field-kwh')?.value).toBe('77');
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('shows a generic message when the error is not an ApiError', async () => {
      const page = await render();
      await page.load(makeSettings());
      await page.submit();

      await page.rejectSave(new Error(SENTINEL));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Ocurrió un error inesperado',
      );
      expect(page.text()).not.toContain(SENTINEL);
    });
  });
});
