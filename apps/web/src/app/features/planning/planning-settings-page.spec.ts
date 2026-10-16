import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PlanningSettings, UpdatePlanningSettingsRequest } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError, type ApiFieldIssue } from '../../core/api/api-error';
import { PlanningApi } from './planning-api';
import { PlanningSettingsPage } from './planning-settings-page';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

function makeSettings(overrides: Partial<PlanningSettings> = {}): PlanningSettings {
  return {
    batchSavingBasisPoints: 1250,
    version: 3,
    updatedAt: '2026-10-16T12:00:00.000Z',
    ...overrides,
  };
}

function problem(status: number, issues: ApiFieldIssue[] = []): ApiError {
  return new ApiError(status, 'problem', 'Mensaje seguro en español.', issues, null, {
    detail: SENTINEL,
  });
}

async function render() {
  const gets: Subject<PlanningSettings>[] = [];
  const puts: Subject<PlanningSettings>[] = [];
  const api = {
    getSettings: vi.fn(() => {
      const reply = new Subject<PlanningSettings>();
      gets.push(reply);
      return reply;
    }),
    putSettings: vi.fn((_body: UpdatePlanningSettingsRequest) => {
      const reply = new Subject<PlanningSettings>();
      puts.push(reply);
      return reply;
    }),
  };
  TestBed.configureTestingModule({
    imports: [PlanningSettingsPage],
    providers: [provideRouter([]), { provide: PlanningApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(PlanningSettingsPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    gets,
    puts,
    text: () => element.textContent,
    input: () => element.querySelector<HTMLInputElement>('#field-saving'),
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    live: () => element.querySelector('[aria-live="polite"]')?.textContent.trim() ?? '',
    async load(settings: PlanningSettings) {
      gets[gets.length - 1]?.next(settings);
      await fixture.whenStable();
    },
    async type(value: string) {
      const input = view.input();
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
    async respond(settings: PlanningSettings) {
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

describe('PlanningSettingsPage', () => {
  it('has one h1 and shows a loading message while waiting', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Ajustes de planificación');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain('Cargando');
  });

  it('shows the saving as a labelled percent field and explains the rule', async () => {
    const page = await render();

    await page.load(makeSettings({ batchSavingBasisPoints: 1250 }));

    expect(page.element.querySelector('label[for="field-saving"]')?.textContent).toBe(
      'Ahorro al agrupar piezas (%)',
    );
    expect(page.input()?.value).toBe('12,5');
    const help = page.element.querySelector('.help');
    expect(help?.querySelectorAll('li')).toHaveLength(5);
    expect(help?.textContent).toContain('10 mm');
    expect(help?.textContent).toContain('90 %');
    expect(help?.textContent).toContain('Con 0 no se ahorra tiempo');
    expect(page.text()).not.toContain('Todavía no guardaste este ajuste');
  });

  it('tells the user nothing is saved when the setting was never saved', async () => {
    const page = await render();

    await page.load(makeSettings({ batchSavingBasisPoints: 0, version: 0, updatedAt: null }));

    expect(page.text()).toContain('Todavía no guardaste este ajuste');
    expect(page.input()?.value).toBe('0');
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

  it.each([
    ['0', 0],
    ['12,5', 1250],
    ['12.5', 1250],
    ['50', 5000],
  ])('saves %j as %i basis points with the loaded version', async (text, basisPoints) => {
    const page = await render();
    await page.load(makeSettings({ version: 3 }));
    await page.type(text);

    await page.submit();

    expect(page.api.putSettings).toHaveBeenCalledExactlyOnceWith({
      batchSavingBasisPoints: basisPoints,
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

  it('sends version 0 for the first save and drops the never-saved notice after it', async () => {
    const page = await render();
    await page.load(makeSettings({ version: 0, updatedAt: null }));
    await page.submit();
    expect(page.api.putSettings).toHaveBeenCalledWith(expect.objectContaining({ version: 0 }));

    await page.respond(makeSettings({ version: 1 }));

    expect(page.text()).not.toContain('Todavía no guardaste este ajuste');
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

  it.each(['', 'abc', '50,01', '51', '1,234', '1,2,3', '12,', '-1'])(
    'rejects %j, focuses the field and does not call the API',
    async (value) => {
      const page = await render();
      await page.load(makeSettings());
      await page.type(value);

      await page.submit();

      expect(page.api.putSettings).not.toHaveBeenCalled();
      const field = page.input();
      expect(field?.getAttribute('aria-invalid')).toBe('true');
      expect(field?.getAttribute('aria-describedby')).toBe('saving-error');
      expect(page.element.querySelector('#saving-error')?.textContent).toContain('0 a 50');
      expect(document.activeElement).toBe(field);
    },
  );

  describe('save errors', () => {
    it('puts a 400 issue next to the field without showing backend text', async () => {
      const page = await render();
      await page.load(makeSettings());
      await page.submit();

      await page.rejectSave(problem(400, [{ path: 'batchSavingBasisPoints', message: SENTINEL }]));

      expect(page.element.querySelector('#saving-error')?.textContent).toBe(
        'El ahorro al agrupar piezas no es válido.',
      );
      expect(document.activeElement).toBe(page.input());
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.button('Guardar')?.disabled).toBe(false);
    });

    it('offers to reload after a stale version and loads the new version', async () => {
      const page = await render();
      await page.load(makeSettings({ version: 3 }));
      await page.submit();

      await page.rejectSave(problem(409, [{ path: 'version', message: SENTINEL }]));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Alguien modificó este ajuste',
      );
      expect(page.text()).not.toContain(SENTINEL);

      page.button('Recargar')?.click();
      await page.fixture.whenStable();
      expect(page.api.getSettings).toHaveBeenCalledTimes(2);
      await page.load(makeSettings({ version: 5, batchSavingBasisPoints: 3000 }));
      expect(page.input()?.value).toBe('30');
      expect(page.element.querySelector('[role="alert"]')).toBeNull();

      await page.submit();
      expect(page.api.putSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ version: 5 }),
      );
    });

    it('shows the safe message for a 503 and keeps what was typed', async () => {
      const page = await render();
      await page.load(makeSettings());
      await page.type('7');
      await page.submit();

      await page.rejectSave(problem(503));

      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
        'Mensaje seguro en español.',
      );
      expect(page.text()).not.toContain(SENTINEL);
      expect(page.input()?.value).toBe('7');
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
