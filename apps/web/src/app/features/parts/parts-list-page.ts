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
import type { Material, Part, PartList, PartUsage } from '@print3d/api-contracts';
import { catchError, map, type Observable, of, scan, startWith, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { PartDeleteDialog } from './part-delete-dialog';
import {
  formatDuration,
  isMaterial,
  MATERIAL_LABELS,
  MATERIAL_ORDER,
  umToMmInput,
} from './part-labels';
import { type ListPartsQuery, PartsApi } from './parts-api';
import { NOTICE_TEXT, readNotice } from './parts-notice';

const PAGE_SIZE = 20;

type SortField = NonNullable<ListPartsQuery['sort']>;
type SortOrder = NonNullable<ListPartsQuery['order']>;

const SORT_OPTIONS: readonly { readonly value: SortField; readonly label: string }[] = [
  { value: 'name', label: 'Nombre' },
  { value: 'createdAt', label: 'Fecha de creación' },
  { value: 'estimatedWeightGrams', label: 'Peso estimado' },
  { value: 'estimatedPrintSeconds', label: 'Tiempo estimado' },
];

const ORDER_OPTIONS: readonly { readonly value: SortOrder; readonly label: string }[] = [
  { value: 'asc', label: 'Ascendente' },
  { value: 'desc', label: 'Descendente' },
];

/** Every state the list can be in. `loading` keeps the previous page so focus is not lost. */
type ViewState =
  | { readonly kind: 'loading'; readonly previous: PartList | null }
  | { readonly kind: 'empty'; readonly filtered: boolean }
  | { readonly kind: 'loaded'; readonly list: PartList }
  | { readonly kind: 'failed'; readonly message: string };

const INITIAL_STATE: ViewState = { kind: 'loading', previous: null };

interface Query {
  readonly material: Material | null;
  readonly sort: SortField;
  readonly order: SortOrder;
  readonly page: number;
  /** Bumped to ask for the same page again (retry, or after a change). */
  readonly reload: number;
}

interface Notice {
  readonly kind: 'success' | 'error';
  readonly text: string;
}

const DELETE_FAILED = 'No se pudo eliminar la pieza. Intentá de nuevo.';

/** What a removal attempt came to. */
type RemoveOutcome =
  | { readonly kind: 'done'; readonly removedFromProjects: number }
  | { readonly kind: 'needsConfirmation'; readonly usage: PartUsage }
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed'; readonly reload: boolean };

/** The 409 for "projects use this part" carries an issue with the path `projects`. */
function isInUse(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.issues.some((issue) => issue.path === 'projects')
  );
}

function failureOf(error: unknown, reloadByDefault: boolean): RemoveOutcome {
  if (error instanceof ApiError && error.status === 404) return { kind: 'gone' };
  const conflict = error instanceof ApiError && error.status === 409;
  return { kind: 'failed', reload: reloadByDefault || conflict };
}

function removedText(projects: number): string {
  if (projects === 0) return NOTICE_TEXT.deleted;
  return `Pieza eliminada y quitada de ${projects === 1 ? '1 proyecto' : `${String(projects)} proyectos`}.`;
}

@Component({
  selector: 'app-parts-list-page',
  imports: [RouterLink, PartDeleteDialog],
  templateUrl: './parts-list-page.html',
  styleUrl: './parts-list-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartsListPage {
  private readonly api = inject(PartsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly materialOptions = MATERIAL_ORDER.map((value) => ({
    value,
    label: MATERIAL_LABELS[value],
  }));
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly orderOptions = ORDER_OPTIONS;

  /** The single source of truth for what is being asked of the API. */
  protected readonly query = signal<Query>({
    material: null,
    sort: 'name',
    order: 'asc',
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
            sort: query.sort,
            order: query.order,
          })
          .pipe(
            map((list): ViewState => {
              if (list.total === 0) return { kind: 'empty', filtered: query.material !== null };
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

  protected readonly deleteTarget = signal<Part | null>(null);
  protected readonly deleting = signal(false);
  /** Set when the API said projects use the target: the dialog then asks for confirmation. */
  protected readonly deleteUsage = signal<PartUsage | null>(null);
  private trigger: HTMLElement | null = null;

  /** The page to draw: the loaded one, or the previous one while the next is loading. */
  protected shownList(view: ViewState): PartList | null {
    if (view.kind === 'loaded') return view.list;
    return view.kind === 'loading' ? view.previous : null;
  }

  protected materialLabel(material: Material): string {
    return MATERIAL_LABELS[material];
  }

  protected dimensions(part: Part): string {
    const { x, y, z } = part.dimensionsMm;
    return `${String(x)} × ${String(y)} × ${String(z)} mm`;
  }

  protected duration(seconds: number): string {
    return formatDuration(seconds);
  }

  protected layerHeight(um: number): string {
    return `${umToMmInput(um)} mm`;
  }

  protected origin(part: Part): string {
    return part.source.kind === 'gcode' ? 'G-code (Cura)' : 'Manual';
  }

  protected rangeText(list: PartList): string | null {
    if (list.items.length === 0) return null;
    const from = (list.page - 1) * list.pageSize + 1;
    const to = from + list.items.length - 1;
    return `Mostrando ${String(from)}–${String(to)} de ${String(list.total)}`;
  }

  protected hasNext(list: PartList): boolean {
    return list.page * list.pageSize < list.total;
  }

  protected changeMaterial(value: string): void {
    const material = isMaterial(value) ? value : null;
    this.query.update((query) => ({ ...query, material, page: 1 }));
  }

  protected changeSort(value: string): void {
    const sort = SORT_OPTIONS.find((option) => option.value === value)?.value;
    if (sort !== undefined) this.query.update((query) => ({ ...query, sort, page: 1 }));
  }

  protected changeOrder(value: string): void {
    const order = ORDER_OPTIONS.find((option) => option.value === value)?.value;
    if (order !== undefined) this.query.update((query) => ({ ...query, order, page: 1 }));
  }

  protected goToPage(page: number): void {
    this.query.update((query) => ({ ...query, page }));
  }

  protected retry(): void {
    this.query.update((query) => ({ ...query, reload: query.reload + 1 }));
  }

  // ---- delete --------------------------------------------------------------------------------

  protected askToDelete(part: Part, event: Event): void {
    this.trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.notice.set(null);
    this.deleteTarget.set(part);
  }

  protected cancelDelete(): void {
    const trigger = this.trigger;
    this.trigger = null;
    this.deleteTarget.set(null);
    this.deleteUsage.set(null);
    afterNextRender(
      () => {
        trigger?.focus();
      },
      { injector: this.injector },
    );
  }

  /**
   * First press: a plain DELETE. If live projects use the part the API answers 409; we then ask
   * who uses it and switch the same dialog to its "in use" mode. Second press (in that mode): the
   * DELETE with `removeFromProjects`, which the API accepts as the confirmation (ADR 0018).
   */
  protected confirmDelete(): void {
    const target = this.deleteTarget();
    if (target === null || this.deleting()) return;
    this.deleting.set(true);

    this.removeOutcome(target.id, this.deleteUsage())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcome) => {
        switch (outcome.kind) {
          case 'done':
            this.finishDelete(
              { kind: 'success', text: removedText(outcome.removedFromProjects) },
              true,
            );
            break;
          case 'needsConfirmation':
            this.deleteUsage.set(outcome.usage);
            this.deleting.set(false);
            break;
          case 'gone':
            this.finishDelete({ kind: 'error', text: NOTICE_TEXT.gone }, true);
            break;
          case 'failed':
            this.finishDelete({ kind: 'error', text: DELETE_FAILED }, outcome.reload);
            break;
        }
      });
  }

  /** One observable for the whole flow, so there are no nested subscriptions. */
  private removeOutcome(id: string, usage: PartUsage | null): Observable<RemoveOutcome> {
    const confirmed = usage !== null;
    const request = confirmed
      ? this.api.remove(id, { removeFromProjects: true })
      : this.api.remove(id);
    return request.pipe(
      map((): RemoveOutcome => ({ kind: 'done', removedFromProjects: usage?.total ?? 0 })),
      catchError((error: unknown): Observable<RemoveOutcome> => {
        if (!confirmed && isInUse(error)) {
          return this.api.usage(id).pipe(
            switchMap((found) =>
              // Someone else emptied the projects meanwhile: nothing left to warn about.
              found.total === 0
                ? this.removeOutcome(id, found)
                : of<RemoveOutcome>({ kind: 'needsConfirmation', usage: found }),
            ),
            catchError((usageError: unknown) => of(failureOf(usageError, true))),
          );
        }
        // A conflict or a failure after the confirmation means the data may have changed.
        return of(failureOf(error, confirmed));
      }),
    );
  }

  private finishDelete(notice: Notice, reload: boolean): void {
    this.deleting.set(false);
    this.deleteTarget.set(null);
    this.deleteUsage.set(null);
    this.trigger = null;
    this.notice.set(notice);
    // The row that opened the dialog may be gone: send focus to the page heading.
    afterNextRender(
      () => {
        this.heading()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
    if (reload) this.reloadAfterRemoval();
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
