import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Filament, FilamentList } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError } from '../../core/api/api-error';
import { FilamentsApi, type ListFilamentsQuery } from './filaments-api';
import { FilamentsListPage } from './filaments-list-page';

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
    version: 1,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

function pageOf(items: Filament[], extra: Partial<FilamentList> = {}): FilamentList {
  return { items, page: 1, pageSize: 20, total: items.length, ...extra };
}

/** `count` filaments named "Marca 1..count", ids unique. */
function manyFilaments(count: number): Filament[] {
  return Array.from({ length: count }, (_, index) =>
    makeFilament({ id: `id-${String(index + 1)}`, brand: `Marca ${String(index + 1)}` }),
  );
}

async function render() {
  const pending: { query: ListFilamentsQuery; reply: Subject<FilamentList> }[] = [];
  const removals: { id: string; reply: Subject<void> }[] = [];
  const consumes: { id: string; grams: number; reply: Subject<Filament> }[] = [];
  const api = {
    list: vi.fn((query: ListFilamentsQuery) => {
      const reply = new Subject<FilamentList>();
      pending.push({ query, reply });
      return reply;
    }),
    remove: vi.fn((id: string) => {
      const reply = new Subject<void>();
      removals.push({ id, reply });
      return reply;
    }),
    consume: vi.fn((id: string, grams: number) => {
      const reply = new Subject<Filament>();
      consumes.push({ id, grams, reply });
      return reply;
    }),
    get: vi.fn(() => new Subject<Filament>()),
  };
  TestBed.configureTestingModule({
    imports: [FilamentsListPage],
    providers: [provideRouter([]), { provide: FilamentsApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(FilamentsListPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    pending,
    removals,
    consumes,
    text: () => element.textContent,
    live: () => element.querySelector('[aria-live="polite"]')?.textContent ?? '',
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    materialSelect: () => element.querySelector<HTMLSelectElement>('#material-filter'),
    stockBox: () => element.querySelector<HTMLInputElement>('#stock-filter'),
    async answer(index: number, list: FilamentList) {
      pending[index]?.reply.next(list);
      pending[index]?.reply.complete();
      await fixture.whenStable();
    },
    async fail(index: number, error: unknown) {
      pending[index]?.reply.error(error);
      await fixture.whenStable();
    },
    async chooseMaterial(material: string) {
      const select = view.materialSelect();
      if (select) {
        select.value = material;
        select.dispatchEvent(new Event('change'));
      }
      await fixture.whenStable();
    },
    async checkStock(checked: boolean) {
      const box = view.stockBox();
      if (box) {
        box.checked = checked;
        box.dispatchEvent(new Event('change'));
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

describe('FilamentsListPage', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });

  it('has one h1 and shows a loading message while waiting', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Filamentos');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain(
      'Cargando filamentos',
    );
  });

  it('requests the first page of 20 with no filters at all', async () => {
    const page = await render();

    expect(page.pending).toHaveLength(1);
    expect(page.pending[0]?.query).toEqual({
      page: 1,
      pageSize: 20,
      material: undefined,
      inStock: undefined,
    });
  });

  it('shows each filament with Spanish labels, stock, cost and date', async () => {
    const page = await render();

    await page.answer(0, pageOf([makeFilament({ material: 'PA_CF' })]));

    const row = page.element.querySelector('tbody tr')?.textContent.replace(/\s+/g, ' ') ?? '';
    expect(row).toContain('Grilon3');
    expect(row).toContain('Nailon con fibra de carbono (PA-CF)');
    expect(row).toContain('Negro');
    expect(row).toContain('800 / 1000 g');
    expect(row).toContain('Disponible');
    expect(row).toContain('$ 15.000,50');
    expect(row).toContain('01-10-2026');
    expect(page.text()).not.toContain('PA_CF');
  });

  it.each([
    [0, 'Sin stock'],
    [200, 'Poco stock'],
    [201, 'Disponible'],
  ])('shows %i g of 1000 as "%s", with text and not only colour', async (grams, text) => {
    const page = await render();

    await page.answer(0, pageOf([makeFilament({ availableGrams: grams })]));

    const indicator = page.element.querySelector('.stock');
    expect(indicator?.textContent).toContain(text);
    expect(indicator?.querySelector('[aria-hidden="true"]')?.textContent.length).toBeGreaterThan(0);
  });

  it('shows the purchase date as written, not shifted by the time zone', async () => {
    const page = await render();

    await page.answer(0, pageOf([makeFilament({ purchaseDate: '2026-10-01' })]));

    expect(page.element.querySelector('tbody')?.textContent).toContain('01-10-2026');
    expect(page.element.querySelector('tbody')?.textContent).not.toContain('30-09-2026');
  });

  it('invites the user to create the first filament when there are none', async () => {
    const page = await render();

    await page.answer(0, pageOf([]));

    expect(page.text()).toContain('Todavía no registraste filamentos. Agregá el primero.');
    const links = Array.from(page.element.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '/filamentos/nuevo',
    );
    expect(links.length).toBeGreaterThan(1);
    expect(page.element.querySelector('table')).toBeNull();
  });

  it('shows a different message when the filters match nothing', async () => {
    const page = await render();
    await page.answer(0, pageOf([makeFilament()]));

    await page.chooseMaterial('TPU');
    await page.answer(1, pageOf([]));

    expect(page.text()).toContain('No hay filamentos con esos filtros');
    expect(page.text()).not.toContain('Todavía no registraste');
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
    await page.answer(1, pageOf([makeFilament()]));

    expect(page.element.querySelector('[role="alert"]')).toBeNull();
    expect(page.text()).toContain('Grilon3');
  });

  describe('filters', () => {
    it('labels the material filter and offers Todos plus the 14 materials', async () => {
      const page = await render();

      const options = Array.from(page.materialSelect()?.options ?? []).map((o) =>
        o.textContent.trim(),
      );
      expect(page.element.querySelector('label[for="material-filter"]')?.textContent).toBe(
        'Material',
      );
      expect(options).toHaveLength(15);
      expect(options[0]).toBe('Todos');
      expect(options).toContain('Policarbonato (PC)');
    });

    it('sends the chosen material and goes back to page 1', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyFilaments(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyFilaments(20), { total: 45, page: 2 }));
      expect(page.pending[1]?.query.page).toBe(2);

      await page.chooseMaterial('PETG');

      expect(page.pending[2]?.query).toMatchObject({ page: 1, material: 'PETG' });
    });

    it('removes the material filter when Todos is chosen again', async () => {
      const page = await render();
      await page.answer(0, pageOf([makeFilament()]));
      await page.chooseMaterial('PETG');
      await page.answer(1, pageOf([makeFilament({ material: 'PETG' })]));

      await page.chooseMaterial('');

      expect(page.pending[2]?.query.material).toBeUndefined();
    });

    it('sends inStock=true only while Con stock is checked and never inStock=false', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyFilaments(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyFilaments(20), { total: 45, page: 2 }));

      await page.checkStock(true);
      await page.answer(2, pageOf([makeFilament()]));
      await page.checkStock(false);

      expect(page.element.querySelector('label:has(#stock-filter)')?.textContent).toContain(
        'Con stock',
      );
      expect(page.pending[2]?.query).toMatchObject({ page: 1, inStock: 'true' });
      expect(page.pending[3]?.query.inStock).toBeUndefined();
      expect(page.pending.map((p) => p.query.inStock)).not.toContain('false');
    });
  });

  describe('pagination', () => {
    it('shows no pagination range when there are no filaments', async () => {
      const page = await render();

      await page.answer(0, pageOf([]));

      expect(page.text()).not.toContain('Mostrando');
      expect(page.button('Siguiente')).toBeUndefined();
    });

    it('disables both buttons when everything fits in one page of exactly 20', async () => {
      const page = await render();

      await page.answer(0, pageOf(manyFilaments(20), { total: 20 }));

      expect(page.text()).toContain('Mostrando 1–20 de 20');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });

    it('enables Siguiente on page 1 of 21 and shows the last single row on page 2', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyFilaments(20), { total: 21 }));
      expect(page.text()).toContain('Mostrando 1–20 de 21');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(false);

      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyFilaments(1), { total: 21, page: 2 }));

      expect(page.text()).toContain('Mostrando 21–21 de 21');
      expect(page.button('Anterior')?.disabled).toBe(false);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });

    it('walks forward and back through 45 filaments using the total from the response', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyFilaments(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyFilaments(20), { total: 45, page: 2 }));
      expect(page.text()).toContain('Mostrando 21–40 de 45');

      await page.click(page.button('Siguiente'));
      await page.answer(2, pageOf(manyFilaments(5), { total: 45, page: 3 }));
      expect(page.text()).toContain('Mostrando 41–45 de 45');
      expect(page.button('Siguiente')?.disabled).toBe(true);

      await page.click(page.button('Anterior'));
      expect(page.pending[3]?.query.page).toBe(2);
    });
  });

  it('shows the latest answer even when an older request answers last', async () => {
    const page = await render();
    await page.answer(0, pageOf([makeFilament({ id: 'a', brand: 'Inicial' })]));
    await page.chooseMaterial('ABS');
    await page.chooseMaterial('TPU');

    await page.answer(2, pageOf([makeFilament({ id: 'c', brand: 'Reciente' })]));
    await page.answer(1, pageOf([makeFilament({ id: 'b', brand: 'Vieja' })]));

    expect(page.text()).toContain('Reciente');
    expect(page.text()).not.toContain('Vieja');
  });

  it('renders a hostile brand and colour as plain text', async () => {
    const page = await render();
    const hostile = '<img src=x onerror=alert(1)>';

    await page.answer(0, pageOf([makeFilament({ brand: hostile, colorName: hostile })]));

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.element.querySelector('tbody th')?.textContent).toBe(hostile);
    expect(page.element.querySelectorAll('tbody td')[1]?.textContent).toBe(hostile);
  });

  it('gives each row an Editar link and one button per action', async () => {
    const page = await render();

    await page.answer(0, pageOf([makeFilament({ id: 'abc' })]));

    const row = page.element.querySelector('tbody tr');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe('/filamentos/abc/editar');
    expect(row?.querySelector('a')?.getAttribute('aria-label')).toBe('Editar Grilon3 · Negro');
    expect(
      Array.from(row?.querySelectorAll('button') ?? []).map((b) => b.textContent.trim()),
    ).toEqual(['Descontar material', 'Eliminar']);
  });

  describe('deleting a filament', () => {
    async function withOne() {
      const page = await render();
      await page.answer(0, pageOf([makeFilament({ id: 'f1' })]));
      const trigger = page.button('Eliminar');
      await page.click(trigger);
      const dialog = () => page.element.querySelector('dialog');
      const dialogButton = (label: string) =>
        Array.from(dialog()?.querySelectorAll('button') ?? []).find(
          (b) => b.textContent.trim() === label,
        );
      return { page, trigger, dialog, dialogButton };
    }

    it('opens a confirmation naming the filament without sending any request', async () => {
      const { page, dialog } = await withOne();

      expect(dialog()?.textContent).toContain('«Grilon3 · Negro»');
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
      expect(page.api.remove).toHaveBeenCalledExactlyOnceWith('f1');
      page.removals[0]?.reply.next();
      page.removals[0]?.reply.complete();
      await page.fixture.whenStable();
      expect(page.pending).toHaveLength(2);
      await page.answer(1, pageOf([]));

      expect(page.live()).toContain('El filamento se eliminó correctamente.');
      expect(page.text()).toContain('Todavía no registraste filamentos');
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

      expect(page.live()).toContain('No se pudo eliminar el filamento. Intentá de nuevo.');
      expect(page.text()).toContain('Grilon3');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.pending).toHaveLength(1);
      expect(page.element.querySelector('dialog')).toBeNull();
    });

    it('reloads and says the filament no longer exists on a 404', async () => {
      const { page, dialogButton } = await withOne();

      await page.click(dialogButton('Eliminar'));
      page.removals[0]?.reply.error(new ApiError(404, 'not_found', 'No existe.'));
      await page.fixture.whenStable();

      expect(page.live()).toContain('El filamento ya no existe.');
      expect(page.pending).toHaveLength(2);
    });

    it('goes back one page when the last row of a later page is removed', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyFilaments(20), { total: 21 }));
      await page.click(page.button('Siguiente'));
      await page.answer(
        1,
        pageOf([makeFilament({ id: 'last', brand: 'Ultima' })], { total: 21, page: 2 }),
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

  describe('consuming material', () => {
    async function withOne() {
      const page = await render();
      await page.answer(0, pageOf([makeFilament({ id: 'f1', availableGrams: 800 })]));
      const trigger = page.button('Descontar material');
      await page.click(trigger);
      const dialog = () => page.element.querySelector('dialog');
      const field = () => dialog()?.querySelector<HTMLInputElement>('#consume-grams') ?? null;
      const submit = async (grams: string) => {
        const input = field();
        if (input) input.value = grams;
        dialog()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
        await page.fixture.whenStable();
      };
      return { page, trigger, dialog, field, submit };
    }

    it('opens the dialog for that filament with the focus on the grams field', async () => {
      const { page, dialog, field } = await withOne();

      expect(dialog()?.textContent).toContain('«Grilon3 · Negro»');
      expect(field()?.getAttribute('max')).toBe('800');
      expect(document.activeElement).toBe(field());
      expect(page.api.consume).not.toHaveBeenCalled();
    });

    it('returns the focus to the trigger when cancelled', async () => {
      const { page, trigger, dialog } = await withOne();

      dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
      await page.fixture.whenStable();

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('closes, announces the grams, reloads and focuses the heading on success', async () => {
      const { page, dialog, submit } = await withOne();

      await submit('30');
      page.consumes[0]?.reply.next(makeFilament({ availableGrams: 770 }));
      page.consumes[0]?.reply.complete();
      await page.fixture.whenStable();
      expect(page.pending).toHaveLength(2);
      await page.answer(1, pageOf([makeFilament({ availableGrams: 770 })]));

      expect(dialog()).toBeNull();
      expect(page.live()).toContain('Se descontaron 30 g.');
      expect(page.text()).toContain('770 / 1000 g');
      expect(document.activeElement).toBe(page.element.querySelector('h1'));
    });

    it('reloads and announces that the filament is gone when the dialog reports a 404', async () => {
      const { page, dialog, submit } = await withOne();

      await submit('30');
      page.consumes[0]?.reply.error(new ApiError(404, 'not_found', 'No existe.'));
      await page.fixture.whenStable();

      expect(dialog()).toBeNull();
      expect(page.live()).toContain('El filamento ya no existe.');
      expect(page.pending).toHaveLength(2);
    });

    it('reloads the list behind the dialog, which stays open, after another error', async () => {
      const { page, dialog, submit } = await withOne();

      await submit('30');
      page.consumes[0]?.reply.error(new ApiError(500, 'internal', 'Ocurrió un error inesperado.'));
      await page.fixture.whenStable();

      expect(dialog()).not.toBeNull();
      expect(page.pending).toHaveLength(2);
    });
  });

  it('shows the message handed over by the form page after a save', async () => {
    const api = {
      list: () => new Subject<FilamentList>(),
      remove: vi.fn(),
      consume: vi.fn(),
      get: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'filamentos', component: FilamentsListPage }]),
        { provide: FilamentsApi, useValue: api },
      ],
    });
    const harness = await RouterTestingHarness.create();

    await TestBed.inject(Router).navigateByUrl('/filamentos', { state: { notice: 'created' } });
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();

    const element = harness.fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'El filamento se creó correctamente.',
    );
  });
});
