import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Part, PartList, PartUsage } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError } from '../../core/api/api-error';
import { type ListPartsQuery, PartsApi } from './parts-api';
import { PartsListPage } from './parts-list-page';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'p1',
    name: 'Soporte de cable',
    description: null,
    material: 'PLA',
    dimensionsMm: { x: 40, y: 30, z: 20 },
    estimatedWeightGrams: 25,
    estimatedPrintSeconds: 7380,
    layerHeightUm: 200,
    suggestedPrinterName: null,
    source: { kind: 'manual' },
    version: 1,
    createdAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
    ...overrides,
  };
}

function pageOf(items: Part[], extra: Partial<PartList> = {}): PartList {
  return { items, page: 1, pageSize: 20, total: items.length, ...extra };
}

/** `count` parts named "Pieza 1..count", ids unique. */
function manyParts(count: number): Part[] {
  return Array.from({ length: count }, (_, index) =>
    makePart({ id: `id-${String(index + 1)}`, name: `Pieza ${String(index + 1)}` }),
  );
}

async function render() {
  const pending: { query: ListPartsQuery; reply: Subject<PartList> }[] = [];
  const removals: {
    id: string;
    options?: { removeFromProjects?: boolean };
    reply: Subject<void>;
  }[] = [];
  const usages: { id: string; reply: Subject<PartUsage> }[] = [];
  const api = {
    list: vi.fn((query: ListPartsQuery) => {
      const reply = new Subject<PartList>();
      pending.push({ query, reply });
      return reply;
    }),
    remove: vi.fn((id: string, options?: { removeFromProjects?: boolean }) => {
      const reply = new Subject<void>();
      removals.push({ id, ...(options === undefined ? {} : { options }), reply });
      return reply;
    }),
    usage: vi.fn((id: string) => {
      const reply = new Subject<PartUsage>();
      usages.push({ id, reply });
      return reply;
    }),
    get: vi.fn(() => new Subject<Part>()),
  };
  TestBed.configureTestingModule({
    imports: [PartsListPage],
    providers: [provideRouter([]), { provide: PartsApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(PartsListPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    pending,
    removals,
    usages,
    text: () => element.textContent,
    live: () => element.querySelector('[aria-live="polite"]')?.textContent ?? '',
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    select: (id: string) => element.querySelector<HTMLSelectElement>(`#${id}`),
    async answer(index: number, list: PartList) {
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

describe('PartsListPage', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });

  it('has one h1 and shows a loading message while waiting', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Piezas');
    expect(page.element.querySelector('[role="status"]')?.textContent).toContain('Cargando piezas');
  });

  it('requests the first page of 20, sorted by name ascending, with no material filter', async () => {
    const page = await render();

    expect(page.pending).toHaveLength(1);
    expect(page.pending[0]?.query).toEqual({
      page: 1,
      pageSize: 20,
      material: undefined,
      sort: 'name',
      order: 'asc',
    });
  });

  it('shows each part with its labels, dimensions, weight, duration, layer height and origin', async () => {
    const page = await render();

    await page.answer(0, pageOf([makePart({ material: 'PA_CF' })]));

    const row = page.element.querySelector('tbody tr')?.textContent.replace(/\s+/g, ' ') ?? '';
    expect(row).toContain('Soporte de cable');
    expect(row).toContain('Nailon con fibra de carbono (PA-CF)');
    expect(row).toContain('40 × 30 × 20 mm');
    expect(row).toContain('25 g');
    expect(row).toContain('2 h 03 min');
    expect(row).toContain('0,2 mm');
    expect(row).toContain('Manual');
    expect(page.text()).not.toContain('PA_CF');
  });

  it('shows a part imported from G-code with its origin and a comma in the layer height', async () => {
    const page = await render();

    await page.answer(
      0,
      pageOf([
        makePart({
          layerHeightUm: 160,
          source: {
            kind: 'gcode',
            fileName: 'a.gcode',
            slicer: 'cura',
            analyzedAt: '2026-10-15T12:00:00.000Z',
          },
        }),
      ]),
    );

    const row = page.element.querySelector('tbody tr')?.textContent.replace(/\s+/g, ' ') ?? '';
    expect(row).toContain('G-code (Cura)');
    expect(row).toContain('0,16 mm');
  });

  it('invites the user to create the first part when there are none', async () => {
    const page = await render();

    await page.answer(0, pageOf([]));

    expect(page.text()).toContain('Todavía no registraste piezas. Agregá la primera.');
    const links = Array.from(page.element.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '/piezas/nueva',
    );
    expect(links.length).toBeGreaterThan(1);
    expect(page.element.querySelector('table')).toBeNull();
  });

  it('shows a different message when the filter matches nothing', async () => {
    const page = await render();
    await page.answer(0, pageOf([makePart()]));

    await page.choose('material-filter', 'TPU');
    await page.answer(1, pageOf([]));

    expect(page.text()).toContain('No hay piezas con ese material');
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
    await page.answer(1, pageOf([makePart()]));

    expect(page.element.querySelector('[role="alert"]')).toBeNull();
    expect(page.text()).toContain('Soporte de cable');
  });

  describe('filter and sort', () => {
    it('labels the material filter and offers Todos plus the 14 materials', async () => {
      const page = await render();

      const options = Array.from(page.select('material-filter')?.options ?? []).map((o) =>
        o.textContent.trim(),
      );
      expect(page.element.querySelector('label[for="material-filter"]')?.textContent).toBe(
        'Material',
      );
      expect(options).toHaveLength(15);
      expect(options[0]).toBe('Todos');
      expect(options).toContain('Policarbonato (PC)');
    });

    it('labels both sort controls and offers the four sortable fields', async () => {
      const page = await render();

      expect(page.element.querySelector('label[for="sort-field"]')?.textContent).toBe(
        'Ordenar por',
      );
      expect(page.element.querySelector('label[for="sort-order"]')?.textContent).toBe('Orden');
      expect(Array.from(page.select('sort-field')?.options ?? []).map((o) => o.value)).toEqual([
        'name',
        'createdAt',
        'estimatedWeightGrams',
        'estimatedPrintSeconds',
      ]);
      expect(Array.from(page.select('sort-order')?.options ?? []).map((o) => o.value)).toEqual([
        'asc',
        'desc',
      ]);
    });

    async function onPageTwo() {
      const page = await render();
      await page.answer(0, pageOf(manyParts(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyParts(20), { total: 45, page: 2 }));
      expect(page.pending[1]?.query.page).toBe(2);
      return page;
    }

    it('sends the chosen material and goes back to page 1', async () => {
      const page = await onPageTwo();

      await page.choose('material-filter', 'PETG');

      expect(page.pending[2]?.query).toMatchObject({ page: 1, material: 'PETG' });
    });

    it('removes the material filter when Todos is chosen again', async () => {
      const page = await render();
      await page.answer(0, pageOf([makePart()]));
      await page.choose('material-filter', 'PETG');
      await page.answer(1, pageOf([makePart({ material: 'PETG' })]));

      await page.choose('material-filter', '');

      expect(page.pending[2]?.query.material).toBeUndefined();
    });

    it('sends the chosen sort field and goes back to page 1', async () => {
      const page = await onPageTwo();

      await page.choose('sort-field', 'estimatedPrintSeconds');

      expect(page.pending[2]?.query).toMatchObject({
        page: 1,
        sort: 'estimatedPrintSeconds',
        order: 'asc',
      });
    });

    it('sends the chosen order, keeps the sort field and goes back to page 1', async () => {
      const page = await onPageTwo();
      await page.choose('sort-field', 'estimatedWeightGrams');
      await page.answer(2, pageOf(manyParts(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(3, pageOf(manyParts(20), { total: 45, page: 2 }));

      await page.choose('sort-order', 'desc');

      expect(page.pending[4]?.query).toMatchObject({
        page: 1,
        sort: 'estimatedWeightGrams',
        order: 'desc',
      });
    });

    it('ignores a sort value outside the allowlist', async () => {
      const page = await render();
      await page.answer(0, pageOf([makePart()]));

      await page.choose('sort-field', 'password');

      expect(page.pending).toHaveLength(1);
    });
  });

  describe('pagination', () => {
    it('shows no pagination range when there are no parts', async () => {
      const page = await render();

      await page.answer(0, pageOf([]));

      expect(page.text()).not.toContain('Mostrando');
      expect(page.button('Siguiente')).toBeUndefined();
    });

    it('disables both buttons when everything fits in one page of exactly 20', async () => {
      const page = await render();

      await page.answer(0, pageOf(manyParts(20), { total: 20 }));

      expect(page.text()).toContain('Mostrando 1–20 de 20');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });

    it('enables Siguiente on page 1 of 21 and shows the last single row on page 2', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyParts(20), { total: 21 }));
      expect(page.text()).toContain('Mostrando 1–20 de 21');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(false);

      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyParts(1), { total: 21, page: 2 }));

      expect(page.text()).toContain('Mostrando 21–21 de 21');
      expect(page.button('Anterior')?.disabled).toBe(false);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });

    it('walks forward and back through 45 parts using the total from the response', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyParts(20), { total: 45 }));
      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyParts(20), { total: 45, page: 2 }));
      expect(page.text()).toContain('Mostrando 21–40 de 45');

      await page.click(page.button('Siguiente'));
      await page.answer(2, pageOf(manyParts(5), { total: 45, page: 3 }));
      expect(page.text()).toContain('Mostrando 41–45 de 45');
      expect(page.button('Siguiente')?.disabled).toBe(true);

      await page.click(page.button('Anterior'));
      expect(page.pending[3]?.query.page).toBe(2);
    });
  });

  it('shows the latest answer even when an older request answers last', async () => {
    const page = await render();
    await page.answer(0, pageOf([makePart({ id: 'a', name: 'Inicial' })]));
    await page.choose('material-filter', 'ABS');
    await page.choose('material-filter', 'TPU');

    await page.answer(2, pageOf([makePart({ id: 'c', name: 'Reciente' })]));
    await page.answer(1, pageOf([makePart({ id: 'b', name: 'Vieja' })]));

    expect(page.text()).toContain('Reciente');
    expect(page.text()).not.toContain('Vieja');
  });

  it('renders a hostile name as plain text', async () => {
    const page = await render();
    const hostile = '<img src=x onerror=alert(1)>';

    await page.answer(0, pageOf([makePart({ name: hostile })]));

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.element.querySelector('tbody th')?.textContent).toBe(hostile);
  });

  it('gives each row an Editar link and an Eliminar button named after the part', async () => {
    const page = await render();

    await page.answer(0, pageOf([makePart({ id: 'abc' })]));

    const row = page.element.querySelector('tbody tr');
    expect(row?.querySelector('a')?.getAttribute('href')).toBe('/piezas/abc/editar');
    expect(row?.querySelector('a')?.getAttribute('aria-label')).toBe('Editar Soporte de cable');
    expect(row?.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Eliminar Soporte de cable',
    );
  });

  describe('deleting a part', () => {
    async function withOne() {
      const page = await render();
      await page.answer(0, pageOf([makePart({ id: 'p1' })]));
      const trigger = page.button('Eliminar');
      await page.click(trigger);
      const dialog = () => page.element.querySelector('dialog');
      const dialogButton = (label: string) =>
        Array.from(dialog()?.querySelectorAll('button') ?? []).find(
          (b) => b.textContent.trim() === label,
        );
      return { page, trigger, dialog, dialogButton };
    }

    it('opens a confirmation naming the part without sending any request', async () => {
      const { page, dialog } = await withOne();

      expect(dialog()?.textContent).toContain('«Soporte de cable»');
      expect(dialog()?.textContent).toContain('se quita de las listas pero se conserva');
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

      expect(page.live()).toContain('La pieza se eliminó correctamente.');
      expect(page.text()).toContain('Todavía no registraste piezas');
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

      expect(page.live()).toContain('No se pudo eliminar la pieza. Intentá de nuevo.');
      expect(page.text()).toContain('Soporte de cable');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.pending).toHaveLength(1);
      expect(page.element.querySelector('dialog')).toBeNull();
    });

    it('reloads and says the part no longer exists on a 404', async () => {
      const { page, dialogButton } = await withOne();

      await page.click(dialogButton('Eliminar'));
      page.removals[0]?.reply.error(new ApiError(404, 'not_found', 'No existe.'));
      await page.fixture.whenStable();

      expect(page.live()).toContain('La pieza ya no existe.');
      expect(page.pending).toHaveLength(2);
    });

    it('goes back one page when the last row of a later page is removed', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyParts(20), { total: 21 }));
      await page.click(page.button('Siguiente'));
      await page.answer(
        1,
        pageOf([makePart({ id: 'last', name: 'Ultima' })], { total: 21, page: 2 }),
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

    describe('when projects use the part', () => {
      const inUseConflict = () =>
        new ApiError(
          409,
          'conflict',
          'Los datos cambiaron.',
          [{ path: 'projects', message: 'm' }],
          null,
          {
            detail: SENTINEL,
          },
        );
      const usage: PartUsage = {
        total: 2,
        projects: [
          { id: 'a', name: 'Taller', quantity: 3 },
          { id: 'b', name: 'Oficina', quantity: 1 },
        ],
      };

      /** Opens the dialog, presses Eliminar and lets the API answer 409 and then the usage. */
      async function reachInUse(found: PartUsage = usage) {
        const context = await withOne();
        await context.page.click(context.dialogButton('Eliminar'));
        context.page.removals[0]?.reply.error(inUseConflict());
        await context.page.fixture.whenStable();
        context.page.usages[0]?.reply.next(found);
        context.page.usages[0]?.reply.complete();
        await context.page.fixture.whenStable();
        return context;
      }

      it('asks for the usage after a 409 and switches the same dialog to in-use mode', async () => {
        const { page, dialog } = await reachInUse();

        expect(page.api.usage).toHaveBeenCalledExactlyOnceWith('p1');
        expect(page.element.querySelectorAll('dialog')).toHaveLength(1);
        expect(dialog()?.querySelector('h2')?.textContent).toBe('La pieza está en uso');
        expect(dialog()?.textContent).toContain(
          'La pieza «Soporte de cable» se usa en 2 proyectos:',
        );
        expect(
          Array.from(dialog()?.querySelectorAll('li') ?? []).map((li) => li.textContent),
        ).toEqual(['Taller (3 u.)', 'Oficina (1 u.)']);
        expect(dialog()?.textContent).toContain('se quitará de esos proyectos');
        expect(page.element.innerHTML).not.toContain(SENTINEL);
        expect(page.pending).toHaveLength(1);
      });

      it('shows how many projects are not listed when the total exceeds the list', async () => {
        const { dialog } = await reachInUse({ total: 52, projects: usage.projects });

        expect(dialog()?.textContent).toContain('y 50 más');
      });

      it('keeps the dialog open with the focus on Cancelar and the buttons enabled', async () => {
        const { dialogButton } = await reachInUse();

        expect(dialogButton('Cancelar')?.disabled).toBe(false);
        expect(dialogButton('Quitar de los proyectos y eliminar')?.disabled).toBe(false);
        expect(document.activeElement).toBe(dialogButton('Cancelar'));
      });

      it('sends the confirmed removal and announces how many projects it was removed from', async () => {
        const { page, dialogButton } = await reachInUse();

        await page.click(dialogButton('Quitar de los proyectos y eliminar'));
        expect(page.removals[1]).toMatchObject({ id: 'p1', options: { removeFromProjects: true } });
        page.removals[1]?.reply.next();
        page.removals[1]?.reply.complete();
        await page.fixture.whenStable();
        expect(page.pending).toHaveLength(2);
        await page.answer(1, pageOf([]));

        expect(page.live()).toContain('Pieza eliminada y quitada de 2 proyectos.');
        expect(page.element.querySelector('dialog')).toBeNull();
        expect(document.activeElement).toBe(page.element.querySelector('h1'));
      });

      it('sends the confirmation once even when the button is pressed twice', async () => {
        const { page, dialogButton } = await reachInUse();
        const confirm = dialogButton('Quitar de los proyectos y eliminar');

        confirm?.click();
        confirm?.click();
        await page.fixture.whenStable();

        expect(page.removals).toHaveLength(2);
        expect(dialogButton('Eliminando…')?.disabled).toBe(true);
      });

      it('cancels without sending anything else and returns the focus to the trigger', async () => {
        const { page, trigger, dialog, dialogButton } = await reachInUse();

        await page.click(dialogButton('Cancelar'));

        expect(dialog()).toBeNull();
        expect(page.removals).toHaveLength(1);
        expect(document.activeElement).toBe(trigger);
      });

      it('opens the plain dialog again for the next part after a cancel', async () => {
        const { page, dialog, dialogButton } = await reachInUse();
        await page.click(dialogButton('Cancelar'));

        await page.click(page.button('Eliminar'));

        expect(dialog()?.querySelector('h2')?.textContent).toBe('Eliminar pieza');
      });

      it('deletes directly with the confirmation when the usage is already empty', async () => {
        const { page } = await reachInUse({ total: 0, projects: [] });

        expect(page.removals[1]).toMatchObject({ id: 'p1', options: { removeFromProjects: true } });
        page.removals[1]?.reply.next();
        page.removals[1]?.reply.complete();
        await page.fixture.whenStable();

        expect(page.live()).toContain('La pieza se eliminó correctamente.');
        expect(page.element.querySelector('dialog')).toBeNull();
      });

      it('says the part no longer exists when the usage answers 404', async () => {
        const { page, dialog } = await withOne().then(async (context) => {
          await context.page.click(context.dialogButton('Eliminar'));
          context.page.removals[0]?.reply.error(inUseConflict());
          await context.page.fixture.whenStable();
          context.page.usages[0]?.reply.error(new ApiError(404, 'not_found', 'No existe.'));
          await context.page.fixture.whenStable();
          return context;
        });

        expect(page.live()).toContain('La pieza ya no existe.');
        expect(dialog()).toBeNull();
        expect(page.pending).toHaveLength(2);
      });

      it('says the part no longer exists when the confirmed removal answers 404', async () => {
        const { page, dialogButton } = await reachInUse();

        await page.click(dialogButton('Quitar de los proyectos y eliminar'));
        page.removals[1]?.reply.error(new ApiError(404, 'not_found', 'No existe.'));
        await page.fixture.whenStable();

        expect(page.live()).toContain('La pieza ya no existe.');
        expect(page.pending).toHaveLength(2);
      });

      it('shows a generic error and reloads when a 409 is not about projects', async () => {
        const { page, dialog } = await withOne().then(async (context) => {
          await context.page.click(context.dialogButton('Eliminar'));
          context.page.removals[0]?.reply.error(
            new ApiError(409, 'conflict', 'x', [{ path: 'version', message: 'm' }], null, {
              detail: SENTINEL,
            }),
          );
          await context.page.fixture.whenStable();
          return context;
        });

        expect(page.api.usage).not.toHaveBeenCalled();
        expect(page.live()).toContain('No se pudo eliminar la pieza. Intentá de nuevo.');
        expect(dialog()).toBeNull();
        expect(page.pending).toHaveLength(2);
        expect(page.element.innerHTML).not.toContain(SENTINEL);
      });

      it('shows a generic error and reloads when the usage cannot be read', async () => {
        const { page, dialog } = await withOne().then(async (context) => {
          await context.page.click(context.dialogButton('Eliminar'));
          context.page.removals[0]?.reply.error(inUseConflict());
          await context.page.fixture.whenStable();
          context.page.usages[0]?.reply.error(
            new ApiError(500, 'internal', 'Ocurrió un error inesperado.', [], null, {
              detail: SENTINEL,
            }),
          );
          await context.page.fixture.whenStable();
          return context;
        });

        expect(page.live()).toContain('No se pudo eliminar la pieza. Intentá de nuevo.');
        expect(dialog()).toBeNull();
        expect(page.pending).toHaveLength(2);
        expect(page.element.innerHTML).not.toContain(SENTINEL);
      });

      it('shows a generic error and reloads when the confirmed removal fails', async () => {
        const { page, dialogButton } = await reachInUse();

        await page.click(dialogButton('Quitar de los proyectos y eliminar'));
        page.removals[1]?.reply.error(
          new ApiError(503, 'unavailable', 'No disponible.', [], null, { detail: SENTINEL }),
        );
        await page.fixture.whenStable();

        expect(page.live()).toContain('No se pudo eliminar la pieza. Intentá de nuevo.');
        expect(page.element.querySelector('dialog')).toBeNull();
        expect(page.pending).toHaveLength(2);
        expect(page.element.innerHTML).not.toContain(SENTINEL);
      });
    });
  });

  it('shows the message handed over by the form page after a save', async () => {
    const api = {
      list: () => new Subject<PartList>(),
      remove: vi.fn(),
      get: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'piezas', component: PartsListPage }]),
        { provide: PartsApi, useValue: api },
      ],
    });
    const harness = await RouterTestingHarness.create();

    await TestBed.inject(Router).navigateByUrl('/piezas', { state: { notice: 'created' } });
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();

    const element = harness.fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'La pieza se creó correctamente.',
    );
  });
});
