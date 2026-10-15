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
import type { Filament, FilamentList, Material } from '@print3d/api-contracts';
import { catchError, map, of, scan, startWith, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { FilamentConsumeDialog } from './filament-consume-dialog';
import { FilamentDeleteDialog } from './filament-delete-dialog';
import {
  formatDate,
  formatMoney,
  isMaterial,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  STOCK_LABELS,
  stockLevel,
} from './filament-labels';
import { FilamentsApi } from './filaments-api';
import { consumedText, NOTICE_TEXT, readNotice } from './filaments-notice';

const PAGE_SIZE = 20;

/** Every state the list can be in. `loading` keeps the previous page so focus is not lost. */
type ViewState =
  | { readonly kind: 'loading'; readonly previous: FilamentList | null }
  | { readonly kind: 'empty'; readonly filtered: boolean }
  | { readonly kind: 'loaded'; readonly list: FilamentList }
  | { readonly kind: 'failed'; readonly message: string };

const INITIAL_STATE: ViewState = { kind: 'loading', previous: null };

interface ListQuery {
  readonly material: Material | null;
  readonly inStockOnly: boolean;
  readonly page: number;
  /** Bumped to ask for the same page again (retry, or after a change). */
  readonly reload: number;
}

interface Notice {
  readonly kind: 'success' | 'error';
  readonly text: string;
}

@Component({
  selector: 'app-filaments-list-page',
  imports: [RouterLink, FilamentDeleteDialog, FilamentConsumeDialog],
  templateUrl: './filaments-list-page.html',
  styleUrl: './filaments-list-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilamentsListPage {
  private readonly api = inject(FilamentsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly materialOptions = MATERIAL_ORDER.map((value) => ({
    value,
    label: MATERIAL_LABELS[value],
  }));

  /** The single source of truth for what is being asked of the API. */
  protected readonly query = signal<ListQuery>({
    material: null,
    inStockOnly: false,
    page: 1,
    reload: 0,
  });

  /**
   * `switchMap` cancels the request still in flight when the query changes, so a slow old
   * answer can never replace a newer one (latest request wins).
   */
  protected readonly state = toSignal(
    toObservable(this.query).pipe(
      switchMap((query) =>
        this.api
          .list({
            page: query.page,
            pageSize: PAGE_SIZE,
            material: query.material ?? undefined,
            // Never send `inStock=false`: it would mean "only empty spools", not "all".
            inStock: query.inStockOnly ? 'true' : undefined,
          })
          .pipe(
            map((list): ViewState => {
              if (list.total === 0) {
                return {
                  kind: 'empty',
                  filtered: query.material !== null || query.inStockOnly,
                };
              }
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

  protected readonly deleteTarget = signal<Filament | null>(null);
  protected readonly deleting = signal(false);
  protected readonly consumeTarget = signal<Filament | null>(null);
  private trigger: HTMLElement | null = null;

  /** The page to draw: the loaded one, or the previous one while the next is loading. */
  protected shownList(view: ViewState): FilamentList | null {
    if (view.kind === 'loaded') return view.list;
    return view.kind === 'loading' ? view.previous : null;
  }

  protected materialLabel(material: Material): string {
    return MATERIAL_LABELS[material];
  }

  protected stockOf(filament: Filament) {
    const level = stockLevel(filament);
    return { level, ...STOCK_LABELS[level] };
  }

  protected money(minor: number): string {
    return formatMoney(minor);
  }

  protected date(isoDate: string): string {
    return formatDate(isoDate);
  }

  protected displayName(filament: Filament): string {
    return `${filament.brand} · ${filament.colorName}`;
  }

  protected rangeText(list: FilamentList): string | null {
    if (list.items.length === 0) return null;
    const from = (list.page - 1) * list.pageSize + 1;
    const to = from + list.items.length - 1;
    return `Mostrando ${String(from)}–${String(to)} de ${String(list.total)}`;
  }

  protected hasNext(list: FilamentList): boolean {
    return list.page * list.pageSize < list.total;
  }

  protected changeMaterial(value: string): void {
    const material = isMaterial(value) ? value : null;
    this.query.update((query) => ({ ...query, material, page: 1 }));
  }

  protected changeInStock(checked: boolean): void {
    this.query.update((query) => ({ ...query, inStockOnly: checked, page: 1 }));
  }

  protected goToPage(page: number): void {
    this.query.update((query) => ({ ...query, page }));
  }

  protected retry(): void {
    this.reload();
  }

  // ---- delete --------------------------------------------------------------------------------

  protected askToDelete(filament: Filament, event: Event): void {
    this.rememberTrigger(event);
    this.deleteTarget.set(filament);
  }

  protected cancelDelete(): void {
    this.deleteTarget.set(null);
    this.restoreFocus();
  }

  protected confirmDelete(): void {
    const target = this.deleteTarget();
    if (target === null || this.deleting()) return;
    this.deleting.set(true);

    this.api
      .remove(target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.deleteTarget.set(null);
          this.announce({ kind: 'success', text: NOTICE_TEXT.deleted });
          this.reloadAfterRemoval();
        },
        error: (error: unknown) => {
          const gone = error instanceof ApiError && error.status === 404;
          this.deleting.set(false);
          this.deleteTarget.set(null);
          this.announce({
            kind: 'error',
            text: gone ? NOTICE_TEXT.gone : 'No se pudo eliminar el filamento. Intentá de nuevo.',
          });
          if (gone) this.reloadAfterRemoval();
        },
      });
  }

  // ---- consume -------------------------------------------------------------------------------

  protected askToConsume(filament: Filament, event: Event): void {
    this.rememberTrigger(event);
    this.consumeTarget.set(filament);
  }

  protected cancelConsume(): void {
    this.consumeTarget.set(null);
    this.restoreFocus();
  }

  protected onConsumed(grams: number): void {
    this.consumeTarget.set(null);
    this.announce({ kind: 'success', text: consumedText(grams) });
    this.reload();
  }

  protected onConsumeTargetGone(): void {
    this.consumeTarget.set(null);
    this.announce({ kind: 'error', text: NOTICE_TEXT.gone });
    this.reloadAfterRemoval();
  }

  /** The dialog stays open with its own message; the list behind it catches up. */
  protected reload(): void {
    this.query.update((query) => ({ ...query, reload: query.reload + 1 }));
  }

  // ---- helpers -------------------------------------------------------------------------------

  private rememberTrigger(event: Event): void {
    this.trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.notice.set(null);
  }

  private restoreFocus(): void {
    const trigger = this.trigger;
    this.trigger = null;
    afterNextRender(
      () => {
        trigger?.focus();
      },
      { injector: this.injector },
    );
  }

  private announce(notice: Notice): void {
    this.trigger = null;
    this.notice.set(notice);
    // The row that opened the dialog may be gone: send focus to the page heading.
    afterNextRender(
      () => {
        this.heading()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
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
