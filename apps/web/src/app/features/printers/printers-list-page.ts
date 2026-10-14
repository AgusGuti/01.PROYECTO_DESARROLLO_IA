import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { Printer, PrinterList, PrinterStatus } from '@print3d/api-contracts';
import { catchError, map, of, scan, startWith, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { PrinterDeleteDialog } from './printer-delete-dialog';
import {
  formatDiameter,
  isPrinterStatus,
  MATERIAL_LABELS,
  NOZZLE_MATERIAL_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
} from './printer-labels';
import { NOTICE_TEXT, readNotice } from './printers-notice';
import { PrintersApi } from './printers-api';

const PAGE_SIZE = 20;

/** Every state the list can be in. `loading` keeps the previous page so focus is not lost. */
type ViewState =
  | { readonly kind: 'loading'; readonly previous: PrinterList | null }
  | { readonly kind: 'empty'; readonly filtered: boolean }
  | { readonly kind: 'loaded'; readonly list: PrinterList }
  | { readonly kind: 'failed'; readonly message: string };

const INITIAL_STATE: ViewState = { kind: 'loading', previous: null };

interface ListQuery {
  readonly status: PrinterStatus | null;
  readonly page: number;
  /** Bumped to ask for the same page again (retry, or after a delete). */
  readonly reload: number;
}

interface Notice {
  readonly kind: 'success' | 'error';
  readonly text: string;
}

@Component({
  selector: 'app-printers-list-page',
  imports: [RouterLink, PrinterDeleteDialog],
  templateUrl: './printers-list-page.html',
  styleUrl: './printers-list-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintersListPage {
  private readonly api = inject(PrintersApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly statusOptions = STATUS_ORDER.map((value) => ({
    value,
    label: STATUS_LABELS[value],
  }));

  /** The single source of truth for what is being asked of the API. */
  protected readonly query = signal<ListQuery>({ status: null, page: 1, reload: 0 });

  /**
   * `switchMap` cancels the request still in flight when the query changes, so a slow old
   * answer can never replace a newer one (latest request wins).
   */
  protected readonly state = toSignal(
    toObservable(this.query).pipe(
      switchMap((query) =>
        this.api
          .list({ page: query.page, pageSize: PAGE_SIZE, status: query.status ?? undefined })
          .pipe(
            map((list): ViewState => {
              if (list.total === 0) return { kind: 'empty', filtered: query.status !== null };
              return { kind: 'loaded', list };
            }),
            catchError((error: unknown) =>
              of<ViewState>({
                kind: 'failed',
                message:
                  error instanceof ApiError
                    ? error.message
                    : 'Ocurrió un error inesperado. Intentá de nuevo.',
              }),
            ),
            startWith<ViewState>({ kind: 'loading', previous: null }),
          ),
      ),
      // Carry the last loaded page into the next `loading` state.
      scan((before, next): ViewState => {
        if (next.kind !== 'loading') return next;
        const previous =
          before.kind === 'loaded'
            ? before.list
            : before.kind === 'loading'
              ? before.previous
              : null;
        return { kind: 'loading', previous };
      }),
    ),
    { initialValue: INITIAL_STATE },
  );

  protected readonly notice = signal<Notice | null>(
    (() => {
      const key = readNotice(inject(Router).currentNavigation()?.extras.state);
      if (key === null) return null;
      return { kind: key === 'gone' ? 'error' : 'success', text: NOTICE_TEXT[key] };
    })(),
  );

  protected readonly deleteTarget = signal<Printer | null>(null);
  protected readonly deleting = signal(false);
  /** Id of the printer being unarchived, or null. */
  protected readonly unarchiving = signal<string | null>(null);
  private trigger: HTMLElement | null = null;

  /** The page to draw: the loaded one, or the previous one while the next is loading. */
  protected shownList(view: ViewState): PrinterList | null {
    if (view.kind === 'loaded') return view.list;
    return view.kind === 'loading' ? view.previous : null;
  }

  protected statusLabel(status: PrinterStatus): string {
    return STATUS_LABELS[status];
  }

  protected materialsText(printer: Printer): string {
    return printer.compatibleMaterials.map((material) => MATERIAL_LABELS[material]).join(', ');
  }

  protected nozzleText(printer: Printer): string {
    return `${formatDiameter(printer.nozzle.diameterMm)} · ${NOZZLE_MATERIAL_LABELS[printer.nozzle.material]}`;
  }

  protected rangeText(list: PrinterList): string | null {
    if (list.items.length === 0) return null;
    const from = (list.page - 1) * list.pageSize + 1;
    const to = from + list.items.length - 1;
    return `Mostrando ${String(from)}–${String(to)} de ${String(list.total)}`;
  }

  protected hasNext(list: PrinterList): boolean {
    return list.page * list.pageSize < list.total;
  }

  protected changeStatus(value: string): void {
    const status = isPrinterStatus(value) ? value : null;
    this.query.update((query) => ({ status, page: 1, reload: query.reload }));
  }

  protected goToPage(page: number): void {
    this.query.update((query) => ({ ...query, page }));
  }

  protected retry(): void {
    this.query.update((query) => ({ ...query, reload: query.reload + 1 }));
  }

  protected askToDelete(printer: Printer, event: Event): void {
    this.trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.notice.set(null);
    this.deleteTarget.set(printer);
  }

  protected cancelDelete(): void {
    this.deleteTarget.set(null);
    const trigger = this.trigger;
    this.trigger = null;
    afterNextRender(() => trigger?.focus(), { injector: this.injector });
  }

  protected confirmDelete(): void {
    const target = this.deleteTarget();
    if (target === null || this.deleting()) return;
    this.deleting.set(true);

    this.api
      .remove(target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        // 204 means "deleted" or "archived" and the response does not say which. A printer that
        // was marked in use is archived (ADR 0006), so the message follows what the user saw.
        next: () => {
          this.finishDelete({
            kind: 'success',
            text:
              target.status === 'in_use'
                ? 'La impresora quedó pendiente de eliminar: se eliminará cuando termine su cola.'
                : 'La impresora se eliminó correctamente.',
          });
          this.reloadAfterRemoval();
        },
        error: (error: unknown) => {
          const gone = error instanceof ApiError && error.status === 404;
          this.finishDelete({
            kind: 'error',
            text: gone
              ? 'La impresora ya no existe.'
              : 'No se pudo eliminar la impresora. Intentá de nuevo.',
          });
          if (gone) this.reloadAfterRemoval();
        },
      });
  }

  /** Harmless and reversible, so no confirmation. The id in flight blocks a second request. */
  protected unarchive(printer: Printer): void {
    if (this.unarchiving() !== null) return;
    this.unarchiving.set(printer.id);
    this.notice.set(null);

    this.api
      .unarchive(printer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.finishUnarchive({ kind: 'success', text: 'La impresora volvió a estar activa.' });
          this.query.update((query) => ({ ...query, reload: query.reload + 1 }));
        },
        error: (error: unknown) => {
          const gone = error instanceof ApiError && error.status === 404;
          this.finishUnarchive({
            kind: 'error',
            text: gone
              ? 'La impresora ya no existe.'
              : 'No se pudo desarchivar la impresora. Intentá de nuevo.',
          });
          if (gone) this.reloadAfterRemoval();
        },
      });
  }

  private finishUnarchive(notice: Notice): void {
    this.unarchiving.set(null);
    this.notice.set(notice);
    // The row changes or disappears: send focus to the page heading.
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }

  private finishDelete(notice: Notice): void {
    this.deleting.set(false);
    this.deleteTarget.set(null);
    this.trigger = null;
    this.notice.set(notice);
    // The row that opened the dialog may be gone: send focus to the page heading.
    afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Reloads the current page, or the one before it when the last row of a page was removed. */
  private reloadAfterRemoval(): void {
    const view = this.state();
    const onlyRowOfPage = view.kind === 'loaded' && view.list.items.length === 1;
    this.query.update((query) => ({
      ...query,
      page: onlyRowOfPage && query.page > 1 ? query.page - 1 : query.page,
      reload: query.reload + 1,
    }));
  }
}
