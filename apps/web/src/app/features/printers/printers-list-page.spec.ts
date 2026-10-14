import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Printer, PrinterList } from '@print3d/api-contracts';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ApiError } from '../../core/api/api-error';
import { PrintersApi, type ListPrintersQuery } from './printers-api';
import { PrintersListPage } from './printers-list-page';

const SENTINEL = 'SENTINEL-backend-detail-9f3a';

function makePrinter(overrides: Partial<Printer> = {}): Printer {
  return {
    id: '66f0c0ffee0123456789abcd',
    name: 'Ender 3 Pro',
    buildVolume: { x: 220, y: 220, z: 250 },
    nozzle: { diameterMm: 0.2, material: 'brass' },
    compatibleMaterials: ['PLA', 'PETG'],
    typicalSpeedMmS: null,
    status: 'available',
    version: 1,
    archivedAt: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  };
}

function pageOf(items: Printer[], extra: Partial<PrinterList> = {}): PrinterList {
  return { items, page: 1, pageSize: 20, total: items.length, ...extra };
}

/** `count` printers named "Impresora 1..count", ids unique. */
function manyPrinters(count: number): Printer[] {
  return Array.from({ length: count }, (_, index) =>
    makePrinter({ id: `id-${String(index + 1)}`, name: `Impresora ${String(index + 1)}` }),
  );
}

interface PendingList {
  readonly query: ListPrintersQuery;
  readonly reply: Subject<PrinterList>;
}

async function render() {
  const pending: PendingList[] = [];
  const removals: { id: string; reply: Subject<void> }[] = [];
  const unarchives: { id: string; reply: Subject<Printer> }[] = [];
  const api = {
    list: vi.fn((query: ListPrintersQuery) => {
      const reply = new Subject<PrinterList>();
      pending.push({ query, reply });
      return reply;
    }),
    remove: vi.fn((id: string) => {
      const reply = new Subject<void>();
      removals.push({ id, reply });
      return reply;
    }),
    unarchive: vi.fn((id: string) => {
      const reply = new Subject<Printer>();
      unarchives.push({ id, reply });
      return reply;
    }),
  };
  TestBed.configureTestingModule({
    imports: [PrintersListPage],
    providers: [provideRouter([]), { provide: PrintersApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(PrintersListPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const view = {
    fixture,
    element,
    api,
    pending,
    removals,
    unarchives,
    text: () => element.textContent,
    button: (label: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label),
    select: () => element.querySelector<HTMLSelectElement>('#status-filter'),
    async answer(index: number, list: PrinterList) {
      pending[index]?.reply.next(list);
      pending[index]?.reply.complete();
      await fixture.whenStable();
    },
    async fail(index: number, error: unknown) {
      pending[index]?.reply.error(error);
      await fixture.whenStable();
    },
    async choose(status: string) {
      const select = view.select();
      if (select) {
        select.value = status;
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

describe('PrintersListPage', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });

  it('has one h1 and shows a loading message while waiting', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('h1')?.textContent).toBe('Impresoras');
    expect(page.text()).toContain('Cargando impresoras');
  });

  it('requests the first page of 20 without a status filter', async () => {
    const page = await render();

    expect(page.pending).toHaveLength(1);
    expect(page.pending[0]?.query).toMatchObject({ page: 1, pageSize: 20 });
    expect(page.pending[0]?.query.status).toBeUndefined();
  });

  it('shows each printer with Spanish labels instead of raw codes', async () => {
    const page = await render();

    await page.answer(
      0,
      pageOf([
        makePrinter({
          status: 'in_use',
          nozzle: { diameterMm: 0.2, material: 'hardened_steel' },
          compatibleMaterials: ['PA_CF', 'PC'],
        }),
      ]),
    );

    const row = page.element.querySelector('tbody tr')?.textContent ?? '';
    expect(row).toContain('Ender 3 Pro');
    expect(row).toContain('En uso');
    expect(row).toContain('220 × 220 × 250 mm');
    expect(row).toContain('0,2 mm');
    expect(row).toContain('Acero endurecido');
    expect(row).toContain('Nailon con fibra de carbono (PA-CF)');
    expect(row).toContain('Policarbonato (PC)');
    expect(page.text()).not.toContain('in_use');
    expect(page.text()).not.toContain('hardened_steel');
  });

  it('invites the user to create the first printer when there are none', async () => {
    const page = await render();

    await page.answer(0, pageOf([]));

    expect(page.text()).toContain('Todavía no registraste impresoras. Agregá la primera.');
    const link = Array.from(page.element.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '/impresoras/nueva',
    );
    expect(link.length).toBeGreaterThan(0);
    expect(page.element.querySelector('table')).toBeNull();
  });

  it('shows a different message when a filter matches nothing', async () => {
    const page = await render();
    await page.answer(0, pageOf([makePrinter()]));

    await page.choose('maintenance');
    await page.answer(1, pageOf([]));

    expect(page.text()).toContain('No hay impresoras con ese estado');
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
    await page.answer(1, pageOf([makePrinter()]));

    expect(page.element.querySelector('[role="alert"]')).toBeNull();
    expect(page.text()).toContain('Ender 3 Pro');
  });

  it('labels the status filter and sends the chosen status from page 1', async () => {
    const page = await render();
    await page.answer(0, pageOf(manyPrinters(20), { total: 45 }));
    await page.click(page.button('Siguiente'));
    await page.answer(1, pageOf(manyPrinters(20), { total: 45, page: 2 }));
    expect(page.pending[1]?.query.page).toBe(2);

    await page.choose('available');

    expect(page.element.querySelector('label[for="status-filter"]')?.textContent).toBe('Estado');
    const options = Array.from(page.select()?.options ?? []).map((o) => o.textContent.trim());
    expect(options).toEqual(['Todos', 'Disponible', 'En uso', 'En mantenimiento']);
    expect(page.pending[2]?.query).toMatchObject({ page: 1, status: 'available' });
  });

  it('removes the status filter when Todos is chosen again', async () => {
    const page = await render();
    await page.answer(0, pageOf([makePrinter()]));
    await page.choose('in_use');
    await page.answer(1, pageOf([makePrinter({ status: 'in_use' })]));

    await page.choose('');

    expect(page.pending[2]?.query.status).toBeUndefined();
  });

  describe('pagination', () => {
    it('shows no pagination range when there are no printers', async () => {
      const page = await render();

      await page.answer(0, pageOf([]));

      expect(page.text()).not.toContain('Mostrando');
      expect(page.button('Siguiente')).toBeUndefined();
    });

    it('disables both buttons when everything fits in one page of exactly 20', async () => {
      const page = await render();

      await page.answer(0, pageOf(manyPrinters(20), { total: 20 }));

      expect(page.text()).toContain('Mostrando 1–20 de 20');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });

    it('enables Siguiente on page 1 of 21 and shows the last single row on page 2', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyPrinters(20), { total: 21 }));
      expect(page.text()).toContain('Mostrando 1–20 de 21');
      expect(page.button('Anterior')?.disabled).toBe(true);
      expect(page.button('Siguiente')?.disabled).toBe(false);

      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyPrinters(1), { total: 21, page: 2 }));

      expect(page.text()).toContain('Mostrando 21–21 de 21');
      expect(page.button('Anterior')?.disabled).toBe(false);
      expect(page.button('Siguiente')?.disabled).toBe(true);
    });

    it('walks through 45 printers in three pages using the total from the response', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyPrinters(20), { total: 45 }));
      expect(page.text()).toContain('Mostrando 1–20 de 45');

      await page.click(page.button('Siguiente'));
      await page.answer(1, pageOf(manyPrinters(20), { total: 45, page: 2 }));
      expect(page.text()).toContain('Mostrando 21–40 de 45');

      await page.click(page.button('Siguiente'));
      await page.answer(2, pageOf(manyPrinters(5), { total: 45, page: 3 }));
      expect(page.text()).toContain('Mostrando 41–45 de 45');
      expect(page.button('Siguiente')?.disabled).toBe(true);

      await page.click(page.button('Anterior'));
      expect(page.pending[3]?.query.page).toBe(2);
    });
  });

  it('shows the latest answer even when an older request answers last', async () => {
    const page = await render();
    await page.answer(0, pageOf([makePrinter({ id: 'a', name: 'Inicial' })]));
    await page.choose('available');
    await page.choose('maintenance');

    await page.answer(2, pageOf([makePrinter({ id: 'c', name: 'Reciente' })]));
    await page.answer(1, pageOf([makePrinter({ id: 'b', name: 'Vieja' })]));

    expect(page.text()).toContain('Reciente');
    expect(page.text()).not.toContain('Vieja');
  });

  it('marks archived printers as pending removal and offers only Desarchivar for them', async () => {
    const page = await render();

    await page.answer(
      0,
      pageOf([
        makePrinter({ id: 'live', name: 'Activa' }),
        makePrinter({ id: 'old', name: 'Archivada', archivedAt: '2026-02-01T10:00:00.000Z' }),
      ]),
    );

    const rows = Array.from(page.element.querySelectorAll('tbody tr'));
    const live = rows.find((row) => row.textContent.includes('Activa'));
    const archived = rows.find((row) => row.textContent.includes('Archivada'));
    expect(archived?.textContent).toContain('Pendiente de eliminar');
    expect(archived?.querySelector('a')).toBeNull();
    expect(
      Array.from(archived?.querySelectorAll('button') ?? []).map((b) => b.textContent.trim()),
    ).toEqual(['Desarchivar']);
    expect(live?.textContent).not.toContain('Pendiente de eliminar');
    expect(live?.querySelector('a')?.getAttribute('href')).toBe('/impresoras/live/editar');
    expect(live?.querySelector('button')?.textContent.trim()).toBe('Eliminar');
  });

  it('renders a hostile printer name as plain text', async () => {
    const page = await render();
    const hostile = '<img src=x onerror=alert(1)>';

    await page.answer(0, pageOf([makePrinter({ name: hostile })]));

    expect(page.element.querySelector('img')).toBeNull();
    expect(page.element.querySelector('tbody th')?.textContent).toBe(hostile);
  });

  describe('deleting a printer', () => {
    async function withOnePrinter() {
      const page = await render();
      await page.answer(0, pageOf([makePrinter({ id: 'p1', name: 'Ender 3 Pro' })]));
      const trigger = page.button('Eliminar');
      await page.click(trigger);
      const dialog = () => page.element.querySelector('dialog');
      const dialogButton = (label: string) =>
        Array.from(dialog()?.querySelectorAll('button') ?? []).find(
          (b) => b.textContent.trim() === label,
        );
      return { page, trigger, dialog, dialogButton };
    }

    it('opens a confirmation naming the printer without sending any request', async () => {
      const { page, dialog } = await withOnePrinter();

      expect(dialog()?.textContent).toContain('«Ender 3 Pro»');
      expect(page.api.remove).not.toHaveBeenCalled();
    });

    it('starts with the focus on Cancelar', async () => {
      const { dialogButton } = await withOnePrinter();

      expect(document.activeElement).toBe(dialogButton('Cancelar'));
    });

    it('does nothing and returns the focus to the trigger when cancelled', async () => {
      const { page, trigger, dialog, dialogButton } = await withOnePrinter();

      await page.click(dialogButton('Cancelar'));

      expect(dialog()).toBeNull();
      expect(page.api.remove).not.toHaveBeenCalled();
      expect(page.api.list).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(trigger);
    });

    it('cancels on Escape without sending a request', async () => {
      const { page, trigger, dialog } = await withOnePrinter();

      dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
      await page.fixture.whenStable();

      expect(dialog()).toBeNull();
      expect(page.api.remove).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    });

    it('deletes after confirmation, reloads the list and announces the result', async () => {
      const { page, dialogButton } = await withOnePrinter();

      await page.click(dialogButton('Eliminar'));
      expect(page.api.remove).toHaveBeenCalledExactlyOnceWith('p1');
      page.removals[0]?.reply.next();
      page.removals[0]?.reply.complete();
      await page.fixture.whenStable();
      expect(page.pending).toHaveLength(2);
      await page.answer(1, pageOf([]));

      const live = page.element.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toContain('La impresora se eliminó correctamente.');
      expect(page.text()).toContain('Todavía no registraste impresoras');
      expect(page.element.querySelector('dialog')).toBeNull();
    });

    it('says the printer is pending removal, not deleted, when it was marked in use', async () => {
      const page = await render();
      await page.answer(
        0,
        pageOf([makePrinter({ id: 'p9', name: 'Prusa MK4', status: 'in_use' })]),
      );
      await page.click(page.button('Eliminar'));
      const dialog = page.element.querySelector('dialog');
      expect(dialog?.textContent).toContain('«En uso»');
      const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent.trim() === 'Eliminar',
      );

      await page.click(confirm);
      page.removals[0]?.reply.next();
      page.removals[0]?.reply.complete();
      await page.fixture.whenStable();
      await page.answer(1, pageOf([]));

      const live = page.element.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toContain('quedó pendiente de eliminar');
      expect(live?.textContent).not.toContain('se eliminó correctamente');
    });

    it('sends a single request even when Eliminar is pressed twice', async () => {
      const { page, dialogButton } = await withOnePrinter();
      const confirm = dialogButton('Eliminar');

      confirm?.click();
      confirm?.click();
      await page.fixture.whenStable();

      expect(page.api.remove).toHaveBeenCalledTimes(1);
    });

    it('keeps the printer and shows a Spanish error when the deletion fails', async () => {
      const { page, dialogButton } = await withOnePrinter();

      await page.click(dialogButton('Eliminar'));
      page.removals[0]?.reply.error(
        new ApiError(500, 'internal', 'Ocurrió un error inesperado.', [], null, {
          detail: SENTINEL,
        }),
      );
      await page.fixture.whenStable();

      expect(page.text()).toContain('No se pudo eliminar la impresora. Intentá de nuevo.');
      expect(page.text()).toContain('Ender 3 Pro');
      expect(page.element.innerHTML).not.toContain(SENTINEL);
      expect(page.pending).toHaveLength(1);
      expect(page.element.querySelector('dialog')).toBeNull();
    });

    it('goes back one page when the last row of a later page is removed', async () => {
      const page = await render();
      await page.answer(0, pageOf(manyPrinters(20), { total: 21 }));
      await page.click(page.button('Siguiente'));
      await page.answer(
        1,
        pageOf([makePrinter({ id: 'last', name: 'Ultima' })], { total: 21, page: 2 }),
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

  describe('unarchiving a printer', () => {
    async function withArchived() {
      const page = await render();
      await page.answer(
        0,
        pageOf([
          makePrinter({ id: 'old', name: 'Archivada', archivedAt: '2026-02-01T10:00:00.000Z' }),
        ]),
      );
      return { page, trigger: page.button('Desarchivar') };
    }
    const live = (page: Awaited<ReturnType<typeof render>>) =>
      page.element.querySelector('[aria-live="polite"]')?.textContent ?? '';

    it('shows no Editar or Eliminar for an archived row', async () => {
      const { page } = await withArchived();

      const row = page.element.querySelector('tbody tr');
      expect(row?.textContent).toContain('Pendiente de eliminar');
      expect(page.button('Eliminar')).toBeUndefined();
      expect(row?.querySelector('a')).toBeNull();
    });

    it('sends one request on click without asking for confirmation', async () => {
      const { page, trigger } = await withArchived();

      await page.click(trigger);

      expect(page.api.unarchive).toHaveBeenCalledExactlyOnceWith('old');
      expect(page.element.querySelector('dialog')).toBeNull();
      expect(page.button('Desarchivar')?.disabled).toBe(true);
    });

    it('sends a single request even when clicked twice', async () => {
      const { page, trigger } = await withArchived();

      trigger?.click();
      trigger?.click();
      await page.fixture.whenStable();

      expect(page.api.unarchive).toHaveBeenCalledTimes(1);
    });

    it('reloads the list, announces it and focuses the heading on success', async () => {
      const { page, trigger } = await withArchived();
      await page.click(trigger);

      page.unarchives[0]?.reply.next(makePrinter({ id: 'old' }));
      page.unarchives[0]?.reply.complete();
      await page.fixture.whenStable();
      expect(page.pending).toHaveLength(2);
      await page.answer(1, pageOf([makePrinter({ id: 'old', name: 'Archivada' })]));

      expect(live(page)).toContain('La impresora volvió a estar activa.');
      expect(page.text()).not.toContain('Pendiente de eliminar');
      expect(document.activeElement).toBe(page.element.querySelector('h1'));
    });

    it('reloads and says the printer no longer exists on a 404', async () => {
      const { page, trigger } = await withArchived();
      await page.click(trigger);

      page.unarchives[0]?.reply.error(new ApiError(404, 'not_found', 'No existe.'));
      await page.fixture.whenStable();

      expect(live(page)).toContain('La impresora ya no existe.');
      expect(page.pending).toHaveLength(2);
    });

    it('keeps the row and shows a generic Spanish error without backend text on failure', async () => {
      const { page, trigger } = await withArchived();
      await page.click(trigger);

      page.unarchives[0]?.reply.error(
        new ApiError(500, 'internal', 'Ocurrió un error inesperado.', [], null, {
          detail: SENTINEL,
        }),
      );
      await page.fixture.whenStable();

      expect(live(page)).toContain('No se pudo desarchivar la impresora. Intentá de nuevo.');
      expect(page.text()).toContain('Archivada');
      expect(page.button('Desarchivar')?.disabled).toBe(false);
      expect(page.pending).toHaveLength(1);
      expect(page.element.innerHTML).not.toContain(SENTINEL);
    });
  });

  it('shows the message handed over by the form page after a save', async () => {
    const api = { list: () => new Subject<PrinterList>(), remove: vi.fn(), unarchive: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'impresoras', component: PrintersListPage }]),
        { provide: PrintersApi, useValue: api },
      ],
    });
    const harness = await RouterTestingHarness.create();

    await TestBed.inject(Router).navigateByUrl('/impresoras', {
      state: { notice: 'created' },
    });
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();

    const element = harness.fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'La impresora se creó correctamente.',
    );
  });
});
