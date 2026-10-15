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
import type { ProjectList, ProjectSummary } from '@print3d/api-contracts';
import { catchError, map, of, scan, startWith, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ProjectDeleteDialog } from './project-delete-dialog';
import {
  formatDeadline,
  isOverdue,
  isPriority,
  linesAndUnits,
  type Priority,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  todayLocal,
} from './project-labels';
import { type ListProjectsQuery, ProjectsApi } from './projects-api';
import { NOTICE_TEXT, readNotice } from './projects-notice';

const PAGE_SIZE = 20;

type SortField = NonNullable<ListProjectsQuery['sort']>;
type SortOrder = NonNullable<ListProjectsQuery['order']>;

const SORT_OPTIONS: readonly { readonly value: SortField; readonly label: string }[] = [
  { value: 'deadline', label: 'Fecha límite' },
  { value: 'priority', label: 'Prioridad' },
  { value: 'name', label: 'Nombre' },
  { value: 'createdAt', label: 'Fecha de creación' },
];

const ORDER_OPTIONS: readonly { readonly value: SortOrder; readonly label: string }[] = [
  { value: 'asc', label: 'Ascendente' },
  { value: 'desc', label: 'Descendente' },
];

/** Every state the list can be in. `loading` keeps the previous page so focus is not lost. */
type ViewState =
  | { readonly kind: 'loading'; readonly previous: ProjectList | null }
  | { readonly kind: 'empty'; readonly filtered: boolean }
  | { readonly kind: 'loaded'; readonly list: ProjectList }
  | { readonly kind: 'failed'; readonly message: string };

const INITIAL_STATE: ViewState = { kind: 'loading', previous: null };

interface Query {
  readonly priority: Priority | null;
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

@Component({
  selector: 'app-projects-list-page',
  imports: [RouterLink, ProjectDeleteDialog],
  templateUrl: './projects-list-page.html',
  styleUrl: './projects-list-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsListPage {
  private readonly api = inject(ProjectsApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly priorityOptions = PRIORITY_ORDER.map((value) => ({
    value,
    label: PRIORITY_LABELS[value],
  }));
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly orderOptions = ORDER_OPTIONS;

  /** The single source of truth for what is being asked of the API. */
  protected readonly query = signal<Query>({
    priority: null,
    sort: 'createdAt',
    order: 'desc',
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
            priority: query.priority ?? undefined,
            sort: query.sort,
            order: query.order,
          })
          .pipe(
            map((list): ViewState => {
              if (list.total === 0) return { kind: 'empty', filtered: query.priority !== null };
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

  protected readonly deleteTarget = signal<ProjectSummary | null>(null);
  protected readonly deleting = signal(false);
  private trigger: HTMLElement | null = null;

  /** The page to draw: the loaded one, or the previous one while the next is loading. */
  protected shownList(view: ViewState): ProjectList | null {
    if (view.kind === 'loaded') return view.list;
    return view.kind === 'loading' ? view.previous : null;
  }

  /** Read on every render, so a page left open past midnight does not keep yesterday. */
  protected currentDay(): string {
    return todayLocal();
  }

  protected priorityLabel(priority: Priority): string {
    return PRIORITY_LABELS[priority];
  }

  protected deadlineText(project: ProjectSummary): string {
    return project.deadline === null ? 'Sin fecha' : formatDeadline(project.deadline);
  }

  protected overdue(project: ProjectSummary, today: string): boolean {
    return isOverdue(project.deadline, today);
  }

  protected piecesText(project: ProjectSummary): string {
    return linesAndUnits(project.itemCount, project.unitCount);
  }

  protected rangeText(list: ProjectList): string | null {
    if (list.items.length === 0) return null;
    const from = (list.page - 1) * list.pageSize + 1;
    const to = from + list.items.length - 1;
    return `Mostrando ${String(from)}–${String(to)} de ${String(list.total)}`;
  }

  protected hasNext(list: ProjectList): boolean {
    return list.page * list.pageSize < list.total;
  }

  protected changePriority(value: string): void {
    const priority = isPriority(value) ? value : null;
    this.query.update((query) => ({ ...query, priority, page: 1 }));
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

  protected askToDelete(project: ProjectSummary, event: Event): void {
    this.trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.notice.set(null);
    this.deleteTarget.set(project);
  }

  protected cancelDelete(): void {
    const trigger = this.trigger;
    this.trigger = null;
    this.deleteTarget.set(null);
    afterNextRender(
      () => {
        trigger?.focus();
      },
      { injector: this.injector },
    );
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
          this.finishDelete({ kind: 'success', text: NOTICE_TEXT.deleted }, true);
        },
        error: (error: unknown) => {
          const gone = error instanceof ApiError && error.status === 404;
          this.finishDelete(
            {
              kind: 'error',
              text: gone ? NOTICE_TEXT.gone : 'No se pudo eliminar el proyecto. Intentá de nuevo.',
            },
            gone,
          );
        },
      });
  }

  private finishDelete(notice: Notice, reload: boolean): void {
    this.deleting.set(false);
    this.deleteTarget.set(null);
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
