import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type FormControl,
  type FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  Queue,
  QueueLine,
  QueueLineEdit,
  QueueLineInput,
  UpdateQueueRequest,
} from '@print3d/api-contracts';
import { catchError, finalize, forkJoin, map, of, startWith, Subject, switchMap } from 'rxjs';
import type { Observable } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { SpoolDialog, type SpoolOption, spoolLabel } from '../../shared/ui/spool-dialog';
import { QueueDeleteDialog } from './queue-delete-dialog';
import {
  formatDuration,
  type Goal,
  GOALS,
  MAX_PRINTERS,
  MAX_QUANTITY,
  MIN_MULTI_PRINTERS,
  type Mode,
  MODES,
  parseQuantity,
} from './queue-labels';
import { type PrinterOption, type ProjectSnapshot, QueuesApi } from './queues-api';

type ViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | {
      readonly kind: 'missing';
      readonly project: ProjectSnapshot;
      readonly printers: readonly PrinterOption[];
      readonly spools: readonly SpoolOption[];
    }
  | {
      readonly kind: 'ready';
      readonly queue: Queue;
      readonly printers: readonly PrinterOption[];
      readonly spools: readonly SpoolOption[];
    };

/** An action that failed; `reload` offers "Recargar" (stale version, queue gone or duplicate). */
interface ActionError {
  readonly message: string;
  readonly reload: boolean;
}

interface ServerErrors {
  readonly goal?: string;
  readonly mode?: string;
  readonly printerIds?: string;
  readonly lines: ReadonlyMap<number, string>;
  readonly spools: ReadonlyMap<number, string>;
}

type LineGroup = FormGroup<{
  partId: FormControl<string>;
  name: FormControl<string>;
  /** The spool id; '' while none is chosen (a legacy line, or one whose spool was deleted). */
  filamentId: FormControl<string>;
  /** The stored spool no longer exists: the line asks for another one (ADR 0036). */
  spoolGone: FormControl<boolean>;
  quantity: FormControl<string>;
}>;

/** The spool dialog serves two purposes: replace a deleted spool, or split a printed line. */
interface DialogState {
  readonly kind: 'replace' | 'split';
  readonly index: number;
}

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const LOADING: ViewState = { kind: 'loading' };
const NO_ERRORS: ServerErrors = { lines: new Map(), spools: new Map() };
const DELETED_PART = 'Pieza eliminada';
const LINE_PATH = /^lines\.(\d+)\.(partId|filamentId|quantity|completed)$/;
const SPOOL_REQUIRED = 'Elegí una bobina para esta línea.';
const SPOOL_INVALID =
  'La bobina no es válida: ya no existe o esta pieza ya está con esa bobina en otra línea.';
const SPOOLS_PENDING = 'Elegí una bobina en las líneas marcadas antes de guardar.';
export const PRINTED_LINE_HINT =
  'Esta línea ya tiene piezas impresas: para usar otra bobina, dividila.';

const LINE_MESSAGES = {
  partId: 'La pieza no es válida.',
  quantity: 'La cantidad tiene que ser un número entero entre 1 y 1000.',
  completed: 'No puede haber más unidades impresas que la cantidad.',
} as const;

function failedState(error: unknown): ViewState {
  return { kind: 'failed', message: error instanceof ApiError ? error.message : GENERIC_ERROR };
}

@Component({
  selector: 'app-queue-page',
  imports: [ReactiveFormsModule, RouterLink, QueueDeleteDialog, SpoolDialog],
  templateUrl: './queue-page.html',
  styleUrl: './queue-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueuePage {
  private readonly api = inject(QueuesApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly projectId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  protected readonly goals = GOALS;
  protected readonly modes = MODES;
  protected readonly maxQuantity = MAX_QUANTITY;
  protected formatDuration = formatDuration;

  protected readonly state = signal<ViewState>(LOADING);
  private readonly loads = new Subject<void>();

  protected readonly lines = this.fb.array<LineGroup>([]);
  protected readonly form = this.fb.group({
    goal: this.fb.control<Goal>('deadline'),
    mode: this.fb.control<Mode>('single'),
    lines: this.lines,
  });
  /** Chosen printer ids. Lives only here (not in the form): select and checkboxes both feed it. */
  protected readonly selected = signal<readonly string[]>([]);
  protected readonly submitted = signal(false);
  /** One request at a time: create, save, +1/-1 and delete all share this flag. */
  protected readonly mutating = signal(false);
  protected readonly action = signal<ActionError | null>(null);
  protected readonly serverErrors = signal<ServerErrors>(NO_ERRORS);
  protected readonly notice = signal<string | null>(null);
  /** Index of the line whose "Impresas" input holds an invalid number. */
  protected readonly progressError = signal<number | null>(null);
  protected readonly confirmingDelete = signal(false);
  private deleteTrigger: HTMLElement | null = null;
  /** The open spool dialog (replace a deleted spool, or split a printed line), if any. */
  protected readonly dialog = signal<DialogState | null>(null);
  private dialogTrigger: HTMLElement | null = null;
  protected readonly printedHint = PRINTED_LINE_HINT;

  constructor() {
    // `switchMap` cancels a load still in flight when "Reintentar" or "Recargar" is pressed.
    this.loads
      .pipe(
        switchMap(() => this.load()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((next) => {
        this.state.set(next);
        this.resetForm(next);
      });
    this.form.controls.mode.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((mode) => {
        if (mode === 'single' && this.selected().length > 1) {
          this.selected.update((ids) => ids.slice(0, 1));
        }
      });
    this.loads.next();
  }

  private load(): Observable<ViewState> {
    const id = this.projectId;
    if (id === null) return of(failedState(null));
    return this.api.get(id).pipe(
      switchMap((queue): Observable<ViewState> => {
        if (queue !== null) {
          return forkJoin({ printers: this.api.printers(), spools: this.api.spools() }).pipe(
            map(({ printers, spools }) => ({ kind: 'ready', queue, printers, spools })),
          );
        }
        return forkJoin({
          printers: this.api.printers(),
          spools: this.api.spools(),
          project: this.api.project(id),
        }).pipe(
          map(({ printers, spools, project }) => ({ kind: 'missing', project, printers, spools })),
        );
      }),
      catchError((error: unknown) => of(failedState(error))),
      startWith(LOADING),
    );
  }

  private resetForm(next: ViewState): void {
    this.submitted.set(false);
    this.serverErrors.set(NO_ERRORS);
    this.action.set(null);
    this.confirmingDelete.set(false);
    this.dialog.set(null);
    this.lines.clear({ emitEvent: false });
    if (next.kind === 'missing') {
      this.form.controls.goal.setValue('deadline', { emitEvent: false });
      this.form.controls.mode.setValue('single', { emitEvent: false });
      this.selected.set([]);
      for (const line of next.project.lines) {
        this.lines.push(
          this.makeLine(line.partId, line.name ?? DELETED_PART, {
            filamentId: line.spoolGone ? '' : (line.filamentId ?? ''),
            gone: line.spoolGone,
            quantity: line.quantity,
          }),
        );
      }
    } else if (next.kind === 'ready') {
      this.form.controls.goal.setValue(next.queue.goal, { emitEvent: false });
      this.form.controls.mode.setValue(next.queue.mode, { emitEvent: false });
      this.selected.set(next.queue.printerIds);
      for (const line of next.queue.lines) {
        const name = line.partDeleted ? DELETED_PART : (line.partName ?? DELETED_PART);
        this.lines.push(
          this.makeLine(line.partId, name, {
            filamentId: line.filamentDeleted ? '' : (line.filamentId ?? ''),
            gone: line.filamentDeleted,
            quantity: line.quantity,
          }),
        );
      }
    }
  }

  private makeLine(
    partId: string,
    name: string,
    spool: { filamentId: string; gone: boolean; quantity: number },
  ): LineGroup {
    return this.fb.group({
      partId: this.fb.control(partId),
      name: this.fb.control(name),
      filamentId: this.fb.control(spool.filamentId),
      spoolGone: this.fb.control(spool.gone),
      quantity: this.fb.control(String(spool.quantity)),
    });
  }

  // ---- template helpers ----------------------------------------------------------------------

  protected isMulti(): boolean {
    return this.form.controls.mode.value === 'multi';
  }

  /** Live printers plus any stored id that is no longer live, so the user can see and replace it. */
  protected printerOptions(
    state: ViewState & { kind: 'missing' | 'ready' },
  ): readonly PrinterOption[] {
    const known = new Set(state.printers.map((printer) => printer.id));
    const extra = this.selected()
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: 'Impresora no disponible' }));
    return [...state.printers, ...extra];
  }

  protected printerError(): string | null {
    const server = this.serverErrors().printerIds;
    if (server !== undefined) return server;
    if (!this.submitted()) return null;
    const count = this.selected().length;
    if (!this.isMulti()) return count === 1 ? null : 'Elegí una impresora.';
    return count >= MIN_MULTI_PRINTERS && count <= MAX_PRINTERS
      ? null
      : `Elegí entre ${String(MIN_MULTI_PRINTERS)} y ${String(MAX_PRINTERS)} impresoras.`;
  }

  protected lineError(index: number): string | null {
    const server = this.serverErrors().lines.get(index);
    if (server !== undefined) return server;
    const control = this.lines.at(index).controls.quantity;
    if (!(control.dirty || this.submitted())) return null;
    return parseQuantity(control.value) === null ? LINE_MESSAGES.quantity : null;
  }

  /** The spool problem of one row: the API's answer, or "none chosen" once a save was tried. */
  protected spoolError(index: number): string | null {
    const server = this.serverErrors().spools.get(index);
    if (server !== undefined) return server;
    const spool = this.lines.at(index).controls.filamentId.value;
    return this.submitted() && spool === '' ? SPOOL_REQUIRED : null;
  }

  /** True while the row still points at a spool that no longer exists. */
  protected spoolIsGone(index: number): boolean {
    const row = this.lines.at(index).controls;
    return row.spoolGone.value && row.filamentId.value === '';
  }

  /** The live spools, plus the row's own spool when the list does not have it. */
  protected spoolChoices(state: ViewState & { kind: 'ready' | 'missing' }, index: number) {
    const own = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    const id = this.lines.at(index).controls.filamentId.value;
    const summary = own?.filament ?? null;
    if (summary === null || id === '' || state.spools.some((spool) => spool.id === id)) {
      return state.spools;
    }
    const { brand, colorName, material, availableGrams } = summary;
    return [
      { id, label: spoolLabel({ brand, colorName, material, availableGrams }) },
      ...state.spools,
    ];
  }

  protected pickRowSpool(index: number, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.lines.at(index).controls.filamentId.setValue(target.value);
    this.serverErrors.update((errors) => ({ ...errors, spools: new Map() }));
  }

  /** "Dividir línea" only makes sense with some pieces printed and some still pending. */
  protected canSplit(index: number): boolean {
    const state = this.state();
    const line = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    return line !== undefined && line.completed > 0 && line.completed < line.quantity;
  }

  /** Spools of the dialog: those the same part already uses on a line are shown but disabled. */
  protected dialogOptions(state: ViewState & { kind: 'ready' | 'missing' }, index: number) {
    const partId = this.lines.at(index).controls.partId.value;
    const taken = new Set(
      this.lines.controls
        .filter((row) => row.controls.partId.value === partId)
        .map((row) => row.controls.filamentId.value),
    );
    return state.spools.map((spool) => ({ ...spool, disabled: taken.has(spool.id) }));
  }

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected pickSingle(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    this.selected.set(target.value === '' ? [] : [target.value]);
  }

  protected toggle(id: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.selected.update((ids) =>
      target.checked ? [...ids, id] : ids.filter((one) => one !== id),
    );
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.serverErrors.set(NO_ERRORS);
  }

  /** Drops a saved line (used for deleted parts): a PATCH with the remaining lines, `completed` included. */
  protected removeSavedLine(index: number): void {
    const state = this.state();
    if (state.kind !== 'ready' || this.projectId === null) return;
    const { queue } = state;
    const lines = this.patchLines(queue, index, (line) => ({
      quantity: line.quantity,
      completed: line.completed,
    }));
    if (lines === null) return;
    this.run(this.api.update(this.projectId, { version: queue.version, lines }), (saved) => {
      // Only that row leaves the form, so other unsaved edits stay aligned with the queue lines.
      this.lines.removeAt(index);
      this.state.set({ ...state, queue: saved });
      this.notice.set('Se quitó la pieza de la cola.');
      this.focusAfterRender('#queue-title');
    });
  }

  protected retry(): void {
    this.loads.next();
  }

  protected reload(): void {
    this.notice.set(null);
    this.loads.next();
  }

  // ---- submit (create or save) ---------------------------------------------------------------

  protected submit(): void {
    const current = this.state();
    if (this.mutating() || this.projectId === null) return;
    this.submitted.set(true);
    this.serverErrors.set(NO_ERRORS);
    const quantities = this.lines.controls.map((line) =>
      parseQuantity(line.controls.quantity.value),
    );
    if (this.printerError() !== null || quantities.some((quantity) => quantity === null)) {
      this.focusFirstInvalid();
      return;
    }
    const raw = this.form.getRawValue();
    const quantityOf = (index: number): number => quantities[index] ?? 1;
    const spoolOf = (index: number): string => raw.lines[index]?.filamentId ?? '';
    const spoolMissing = raw.lines.some((_, index) => spoolOf(index) === '');

    if (current.kind === 'missing') {
      if (spoolMissing) {
        this.focusFirstInvalid();
        return;
      }
      const lines: QueueLineInput[] = raw.lines.map((line, index) => ({
        partId: line.partId,
        filamentId: line.filamentId,
        quantity: quantityOf(index),
      }));
      this.run(
        this.api.create({
          projectId: this.projectId,
          goal: raw.goal,
          mode: raw.mode,
          printerIds: [...this.selected()],
          lines,
        }),
        (queue) => {
          this.finish(queue, 'La cola se creó.');
        },
      );
    } else if (current.kind === 'ready') {
      const queue = current.queue;
      const patch: { -readonly [K in keyof UpdateQueueRequest]: UpdateQueueRequest[K] } = {
        version: queue.version,
      };
      if (raw.goal !== queue.goal) patch.goal = raw.goal;
      if (raw.mode !== queue.mode) patch.mode = raw.mode;
      const ids = this.selected();
      if (
        ids.length !== queue.printerIds.length ||
        ids.some((id) => !queue.printerIds.includes(id))
      ) {
        patch.printerIds = [...ids];
      }
      // A deleted or missing spool counts as "unchanged" until the user picks another one.
      const savedSpool = (index: number): string => {
        const line = queue.lines[index];
        return line === undefined || line.filamentDeleted ? '' : (line.filamentId ?? '');
      };
      if (
        queue.lines.some(
          (line, index) =>
            line.quantity !== quantityOf(index) || savedSpool(index) !== spoolOf(index),
        )
      ) {
        if (spoolMissing) {
          this.focusFirstInvalid();
          return;
        }
        patch.lines = queue.lines.map((line, index) => ({
          partId: line.partId,
          filamentId: spoolOf(index),
          quantity: quantityOf(index),
          completed: line.completed,
        }));
      }
      if (Object.keys(patch).length === 1) {
        this.notice.set('No hay cambios para guardar.');
        return;
      }
      this.run(this.api.update(this.projectId, patch), (saved) => {
        this.finish(saved, 'Los cambios se guardaron.');
      });
    }
  }

  private finish(queue: Queue, message: string): void {
    const next: ViewState = { kind: 'ready', queue, ...this.context() };
    this.state.set(next);
    this.resetForm(next);
    this.notice.set(message);
    this.focusAfterRender('#queue-title');
  }

  private context(): {
    readonly printers: readonly PrinterOption[];
    readonly spools: readonly SpoolOption[];
  } {
    const state = this.state();
    return state.kind === 'missing' || state.kind === 'ready'
      ? { printers: state.printers, spools: state.spools }
      : { printers: [], spools: [] };
  }

  // ---- progress ------------------------------------------------------------------------------

  protected canStep(index: number, delta: 1 | -1): boolean {
    const state = this.state();
    const line = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    if (line === undefined) return false;
    return delta === 1 ? line.completed < line.quantity : line.completed > 0;
  }

  protected step(index: number, delta: 1 | -1): void {
    const state = this.state();
    const line = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    if (line === undefined || !this.canStep(index, delta)) return;
    const id = `#line-${String(index)}-`;
    // A disabled button drops focus: put it back on the button, or its twin at a limit.
    const same = delta === 1 ? 'plus' : 'minus';
    const twin = delta === 1 ? 'minus' : 'plus';
    this.setCompleted(
      index,
      line.completed + delta,
      `${id}${same}:not(:disabled), ${id}${twin}:not(:disabled)`,
    );
  }

  /** "Completar": every unit of the line printed. */
  protected complete(index: number): void {
    const state = this.state();
    const line = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    if (line === undefined || line.completed >= line.quantity) return;
    this.setCompleted(index, line.quantity, `#line-${String(index)}-completed`);
  }

  /** Commits the "Impresas" field (change, Enter or blur). Invalid input is never sent. */
  protected commitCompleted(index: number, event: Event): void {
    const target = event.target;
    const state = this.state();
    const line = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    if (!(target instanceof HTMLInputElement) || line === undefined || this.mutating()) return;
    const text = target.value.trim();
    const value = /^\d+$/.test(text) ? Number(text) : -1;
    if (value < 0 || value > line.quantity) {
      this.progressError.set(index);
      return;
    }
    this.progressError.set(null);
    if (value !== line.completed) {
      this.setCompleted(index, value, `#line-${String(index)}-completed`);
    }
  }

  protected progressMessage(index: number): string | null {
    const state = this.state();
    const line = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    return this.progressError() === index && line !== undefined
      ? `Ingresá un número entre 0 y ${String(line.quantity)}`
      : null;
  }

  /** One PATCH with every line intact except the changed `completed`. */
  private setCompleted(index: number, completed: number, focusSelector: string): void {
    const state = this.state();
    if (state.kind !== 'ready' || this.projectId === null) return;
    const { queue } = state;
    const lines = this.patchLines(queue, null, (line, position) => ({
      quantity: line.quantity,
      completed: position === index ? completed : line.completed,
    }));
    if (lines === null) return;
    this.progressError.set(null);
    this.run(this.api.update(this.projectId, { version: queue.version, lines }), (saved) => {
      // Only the queue is replaced: unsaved edits in the form (goal, quantities) are kept.
      this.state.set({ ...state, queue: saved });
      this.notice.set('Se actualizó el avance.');
      this.focusAfterRender(focusSelector);
    });
  }

  /**
   * The whole-lines body of a PATCH built from the saved queue. Each line keeps its saved spool;
   * a line without a live spool needs the one the user picked, and without it nothing is sent.
   */
  private patchLines(
    queue: Queue,
    skip: number | null,
    change: (line: QueueLine, index: number) => Pick<QueueLineEdit, 'quantity' | 'completed'>,
  ): QueueLineEdit[] | null {
    const lines: QueueLineEdit[] = [];
    for (const [index, line] of queue.lines.entries()) {
      if (index === skip) continue;
      const chosen = this.lines.at(index).controls.filamentId.value;
      const filamentId =
        line.filamentId !== null && !line.filamentDeleted ? line.filamentId : chosen;
      if (filamentId === '') {
        this.submitted.set(true);
        this.action.set({ message: SPOOLS_PENDING, reload: false });
        this.focusFirstInvalid();
        return null;
      }
      lines.push({ partId: line.partId, filamentId, ...change(line, index) });
    }
    return lines;
  }

  // ---- spool dialog (replace a deleted spool, or split a printed line) -----------------------

  protected openDialog(kind: DialogState['kind'], index: number, event: Event): void {
    this.dialogTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.notice.set(null);
    this.dialog.set({ kind, index });
  }

  protected closeDialog(): void {
    const trigger = this.dialogTrigger;
    this.dialogTrigger = null;
    this.dialog.set(null);
    afterNextRender(
      () => {
        trigger?.focus();
      },
      { injector: this.injector },
    );
  }

  protected pickFromDialog(spoolId: string): void {
    const open = this.dialog();
    if (open === null) return;
    this.dialogTrigger = null;
    this.dialog.set(null);
    if (open.kind === 'replace') {
      this.lines.at(open.index).controls.filamentId.setValue(spoolId);
      this.serverErrors.update((errors) => ({ ...errors, spools: new Map() }));
      this.focusAfterRender(`#line-${String(open.index)}-spool`);
    } else {
      this.split(open.index, spoolId);
    }
  }

  /**
   * "Dividir línea": the printed pieces stay on the line with their spool, and a new line of the
   * same part takes the pending ones with the chosen spool (ADR 0036). One whole-lines PATCH.
   */
  private split(index: number, spoolId: string): void {
    const state = this.state();
    const line = state.kind === 'ready' ? state.queue.lines[index] : undefined;
    if (state.kind !== 'ready' || line === undefined || this.projectId === null) return;
    const { queue } = state;
    const pending = line.quantity - line.completed;
    const lines = this.patchLines(queue, null, (other, position) => ({
      quantity: position === index ? other.completed : other.quantity,
      completed: other.completed,
    }));
    if (lines === null) return;
    lines.splice(index + 1, 0, {
      partId: line.partId,
      filamentId: spoolId,
      quantity: pending,
      completed: 0,
    });
    this.run(this.api.update(this.projectId, { version: queue.version, lines }), (saved) => {
      // Keep unsaved edits: shrink the printed row and add the new one right below it.
      const row = this.lines.at(index);
      row.controls.quantity.setValue(String(line.completed));
      this.lines.insert(
        index + 1,
        this.makeLine(line.partId, row.controls.name.value, {
          filamentId: spoolId,
          gone: false,
          quantity: pending,
        }),
      );
      this.state.set({ ...state, queue: saved });
      this.notice.set('La línea se dividió.');
      this.focusAfterRender(`#line-${String(index + 1)}-spool`);
    });
  }

  // ---- delete --------------------------------------------------------------------------------

  protected askToDelete(event: Event): void {
    this.deleteTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.notice.set(null);
    this.confirmingDelete.set(true);
  }

  protected cancelDelete(): void {
    this.closeDelete();
  }

  protected confirmDelete(): void {
    const state = this.state();
    if (state.kind !== 'ready' || this.projectId === null) return;
    this.run(this.api.remove(this.projectId, state.queue.version), () => {
      this.confirmingDelete.set(false);
      this.deleteTrigger = null;
      this.loads.next();
      this.notice.set('La cola se eliminó.');
      this.focusAfterRender('#queue-title');
    });
  }

  private closeDelete(): void {
    const trigger = this.deleteTrigger;
    this.deleteTrigger = null;
    this.confirmingDelete.set(false);
    afterNextRender(
      () => {
        trigger?.focus();
      },
      { injector: this.injector },
    );
  }

  // ---- requests and failures -----------------------------------------------------------------

  private run<T>(request: Observable<T>, onSuccess: (value: T) => void): void {
    if (this.mutating()) return;
    this.mutating.set(true);
    this.action.set(null);
    this.notice.set(null);
    request
      .pipe(
        finalize(() => {
          this.mutating.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: onSuccess,
        error: (error: unknown) => {
          this.fail(error);
        },
      });
  }

  private fail(error: unknown): void {
    if (this.confirmingDelete()) this.closeDelete();
    if (!(error instanceof ApiError)) {
      this.action.set({ message: GENERIC_ERROR, reload: false });
      return;
    }
    if (error.status === 409) {
      const duplicate = error.issues.some((issue) => issue.path === 'projectId');
      this.action.set({
        message: duplicate
          ? 'Este proyecto ya tiene una cola. Recargá para verla.'
          : 'La cola cambió mientras trabajabas. Recargá para ver la versión actual.',
        reload: true,
      });
      return;
    }
    if (error.status === 404) {
      this.action.set({ message: 'La cola ya no existe. Recargá para continuar.', reload: true });
      return;
    }
    if (error.status === 400 && this.mapIssues(error)) {
      this.action.set({ message: 'Revisá los datos marcados e intentá de nuevo.', reload: false });
      this.focusFirstInvalid();
      return;
    }
    this.action.set({ message: error.message, reload: false });
  }

  /** Turns issue paths into fixed Spanish messages; true when at least one field was marked. */
  private mapIssues(error: ApiError): boolean {
    const lines = new Map<number, string>();
    const spools = new Map<number, string>();
    let goal: string | undefined;
    let mode: string | undefined;
    let printerIds: string | undefined;
    for (const issue of error.issues) {
      const line = LINE_PATH.exec(issue.path);
      if (line !== null && line[2] === 'filamentId') {
        spools.set(Number(line[1]), SPOOL_INVALID);
      } else if (line !== null) {
        const field = line[2] as keyof typeof LINE_MESSAGES;
        lines.set(Number(line[1]), LINE_MESSAGES[field]);
      } else if (issue.path === 'goal') {
        goal = 'El objetivo no es válido.';
      } else if (issue.path === 'mode') {
        mode = 'El modo no es válido para las impresoras elegidas.';
      } else if (issue.path === 'printerIds' || issue.path.startsWith('printerIds.')) {
        printerIds =
          'Revisá las impresoras: tienen que existir, no estar archivadas y coincidir con el modo.';
      }
    }
    const none = goal === undefined && mode === undefined && printerIds === undefined;
    if (none && lines.size === 0 && spools.size === 0) return false;
    this.serverErrors.set({ goal, mode, printerIds, lines, spools });
    return true;
  }

  private focusFirstInvalid(): void {
    this.focusAfterRender('[aria-invalid="true"], [data-invalid="true"]');
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }
}
