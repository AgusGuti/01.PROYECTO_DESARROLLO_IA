import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  type FormControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  CreateProjectRequest,
  Project,
  ProjectItemInput,
  UpdateProjectRequest,
} from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { DateTools } from '../../shared/ui/date-tools';
import { type PickerPart, PartsPickerApi } from './parts-picker-api';
import {
  formatDeadline,
  isDeadlineInRange,
  MATERIAL_LABELS,
  type Priority,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  parseDeadline,
} from './project-labels';
import { ProjectsApi } from './projects-api';
import { noticeState, type ProjectsNotice } from './projects-notice';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly project: Project | null }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'failed'; readonly message: string };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** `stale` means someone else saved first: the page offers to reload. */
  | { readonly kind: 'failed'; readonly message: string; readonly stale: boolean };

type PickerState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly parts: readonly PickerPart[]; readonly truncated: boolean }
  | { readonly kind: 'failed'; readonly message: string };

type FieldKey = 'name' | 'description' | 'priority' | 'deadline';

/** One row of the items editor. `name` is null when the part is no longer live ("deleted"). */
interface Line {
  readonly partId: string;
  readonly name: string | null;
  readonly quantity: FormControl<number | null>;
}

/** Top-to-bottom order, used to move focus to the first invalid field. */
const FIELD_ORDER: readonly FieldKey[] = ['name', 'description', 'priority', 'deadline'];

const ISSUE_FIELD: ReadonlyMap<string, FieldKey> = new Map([
  ['name', 'name'],
  ['description', 'description'],
  ['priority', 'priority'],
  ['deadline', 'deadline'],
]);

/** The dotted path the API uses for a problem inside one line: `items.3.quantity`. */
const LINE_PATH = /^items\.(\d+)\.(partId|quantity)$/;

const SERVER_REJECTED: Readonly<Record<FieldKey, string>> = {
  name: 'El nombre no es válido.',
  description: 'La descripción no es válida.',
  priority: 'La prioridad no es válida.',
  deadline: 'La fecha límite no es válida.',
};

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 1000;
export const MAX_LINES = 100;
const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const QUANTITY_MESSAGE = `Ingresá una cantidad entera entre ${String(MIN_QUANTITY)} y ${String(MAX_QUANTITY)}.`;
const PART_ISSUE_MESSAGE =
  'Esta pieza no es válida: ya no existe o está repetida. Quitala e intentá de nuevo.';
const ITEMS_ISSUE_MESSAGE = 'Revisá las piezas del proyecto.';
const INITIAL_LOAD: LoadState = { kind: 'loading' };
const INITIAL_PICKER: PickerState = { kind: 'loading' };

const VALIDATION_MESSAGES: Readonly<Record<FieldKey, (errors: ValidationErrors) => string>> = {
  name: (errors) =>
    errors['maxlength']
      ? `El nombre puede tener hasta ${String(MAX_NAME_LENGTH)} caracteres.`
      : errors['control']
        ? 'El nombre no puede tener saltos de línea ni caracteres de control.'
        : 'Ingresá el nombre.',
  description: (errors) =>
    errors['maxlength']
      ? `La descripción puede tener hasta ${String(MAX_DESCRIPTION_LENGTH)} caracteres.`
      : 'La descripción debe ser una sola línea, sin caracteres de control.',
  priority: () => SERVER_REJECTED.priority,
  deadline: () => 'Ingresá una fecha válida entre el 01-01-2000 y el 31-12-2099 (DD-MM-AAAA).',
};

// Client validation mirrors the API limits. It is a convenience: the server decides.
function textValidator(max: number, optional: boolean): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const text = String(control.value).trim();
    if (text.length === 0) return optional ? null : { required: true };
    if (/\p{Cc}/u.test(text)) return { control: true };
    return Array.from(text).length > max ? { maxlength: true } : null;
  };
}

function quantityValidator(control: AbstractControl): ValidationErrors | null {
  const value: unknown = control.value;
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_QUANTITY &&
    value <= MAX_QUANTITY
    ? null
    : { range: true };
}

function deadlineValidator(control: AbstractControl<string>): ValidationErrors | null {
  return control.value === '' || isDeadlineInRange(control.value) ? null : { range: true };
}

function hasPath(error: ApiError, path: string): boolean {
  return error.issues.some((issue) => issue.path === path);
}

function sameItems(project: Project, items: readonly ProjectItemInput[]): boolean {
  return (
    project.items.length === items.length &&
    project.items.every(
      (item, index) =>
        item.partId === items[index]?.partId && item.quantity === items[index].quantity,
    )
  );
}

@Component({
  selector: 'app-project-form-page',
  imports: [DateTools, ReactiveFormsModule, RouterLink],
  templateUrl: './project-form-page.html',
  styleUrl: './project-form-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectFormPage {
  private readonly api = inject(ProjectsApi);
  private readonly pickerApi = inject(PartsPickerApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);

  /** `null` on /proyectos/nuevo, the project id on /proyectos/:id/editar. */
  protected readonly projectId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  protected readonly priorityOptions = PRIORITY_ORDER.map((value) => ({
    value,
    label: PRIORITY_LABELS[value],
  }));
  protected readonly maxLines = MAX_LINES;

  protected readonly form = this.fb.group({
    name: this.fb.control('', textValidator(MAX_NAME_LENGTH, false)),
    description: this.fb.control('', textValidator(MAX_DESCRIPTION_LENGTH, true)),
    priority: this.fb.control<Priority>('normal'),
    deadline: this.fb.control('', deadlineValidator),
  });

  // The "add a part" controls are standalone: they are not part of what gets saved.
  protected readonly partControl = this.fb.control('');
  protected readonly addQuantity = this.fb.control<number | null>(1);

  protected readonly submitted = signal(false);
  protected readonly save = signal<SaveState>({ kind: 'idle' });
  protected readonly lines = signal<readonly Line[]>([]);
  /** Problems the API reported for one line (by index) or for the items as a whole. */
  protected readonly lineIssues = signal<ReadonlyMap<number, string>>(new Map());
  protected readonly itemsIssue = signal<string | null>(null);
  protected readonly addError = signal<string | null>(null);
  /** Text for the polite live region: "Pieza agregada" / "Pieza quitada". */
  protected readonly announcement = signal('');

  private readonly loadRequests = new Subject<void>();
  private readonly pickerRequests = new Subject<void>();

  /** Create: ready at once. Edit: loads the project; `switchMap` drops superseded loads. */
  protected readonly load = toSignal(
    this.loadRequests.pipe(
      startWith(undefined),
      switchMap(() => {
        const id = this.projectId;
        if (id === null) return of<LoadState>({ kind: 'ready', project: null });
        return this.api.get(id).pipe(
          map((project): LoadState => {
            this.populate(project);
            return { kind: 'ready', project };
          }),
          catchError((error: unknown) =>
            of<LoadState>(
              error instanceof ApiError && error.status === 404
                ? { kind: 'notFound' }
                : {
                    kind: 'failed',
                    message: error instanceof ApiError ? error.message : GENERIC_ERROR,
                  },
            ),
          ),
          startWith<LoadState>({ kind: 'loading' }),
        );
      }),
    ),
    { initialValue: INITIAL_LOAD },
  );

  /** The catalogue for the part picker, loaded once and again on "Reintentar". */
  protected readonly picker = toSignal(
    this.pickerRequests.pipe(
      startWith(undefined),
      switchMap(() =>
        this.pickerApi.loadAll().pipe(
          map((catalogue): PickerState => ({
            kind: 'ready',
            parts: catalogue.parts,
            truncated: catalogue.truncated,
          })),
          catchError((error: unknown) =>
            of<PickerState>({
              kind: 'failed',
              message: error instanceof ApiError ? error.message : GENERIC_ERROR,
            }),
          ),
          startWith<PickerState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: INITIAL_PICKER },
  );

  /** "Name · Material" for each part not yet in the project. */
  protected readonly partOptions = computed(() => {
    const picker = this.picker();
    if (picker.kind !== 'ready') return [];
    const used = new Set(this.lines().map((line) => line.partId));
    return picker.parts
      .filter((part) => !used.has(part.id))
      .map((part) => ({ id: part.id, label: `${part.name} · ${MATERIAL_LABELS[part.material]}` }));
  });

  protected readonly hasDeletedLine = computed(() =>
    this.lines().some((line) => line.name === null),
  );

  // ---- validation messages -------------------------------------------------------------------

  /** The visible error for a field, or null. Shown once the user touched it or tried to save. */
  protected errorFor(field: FieldKey): string | null {
    const control = this.form.controls[field];
    if (!control.invalid || !(control.touched || this.submitted())) return null;
    if (control.errors?.['server']) return SERVER_REJECTED[field];
    return VALIDATION_MESSAGES[field](control.errors ?? {});
  }

  /** Ids of the hint and error paragraphs that currently exist, for `aria-describedby`. */
  protected describedBy(field: FieldKey, hintId: string | null): string | null {
    const ids = [
      ...(hintId === null ? [] : [hintId]),
      ...(this.errorFor(field) === null ? [] : [`error-${field}`]),
    ];
    return ids.length === 0 ? null : ids.join(' ');
  }

  protected lineError(line: Line, index: number): string | null {
    if (line.quantity.invalid && (line.quantity.touched || this.submitted())) {
      return QUANTITY_MESSAGE;
    }
    return this.lineIssues().get(index) ?? null;
  }

  protected lineName(line: Line): string {
    return line.name ?? 'Pieza eliminada';
  }

  // ---- items editor --------------------------------------------------------------------------

  protected addLine(): void {
    if (this.lines().length >= MAX_LINES) return;
    const picker = this.picker();
    const part =
      picker.kind === 'ready'
        ? picker.parts.find((candidate) => candidate.id === this.partControl.value)
        : undefined;
    if (part === undefined) {
      this.addError.set('Elegí una pieza para agregar.');
      this.focus('field-part');
      return;
    }
    if (quantityValidator(this.addQuantity) !== null) {
      this.addError.set(QUANTITY_MESSAGE);
      this.focus('field-add-quantity');
      return;
    }

    const quantity = this.fb.control<number | null>(this.addQuantity.value, quantityValidator);
    this.lines.update((lines) => [...lines, { partId: part.id, name: part.name, quantity }]);
    this.partControl.setValue('');
    this.addQuantity.setValue(1);
    this.itemsChanged('Pieza agregada');
    this.focus('field-part');
  }

  protected removeLine(index: number): void {
    this.lines.update((lines) => lines.filter((_, position) => position !== index));
    this.itemsChanged('Pieza quitada');
    this.focus('field-part');
  }

  /** The user edited a quantity: what the API said about the lines no longer applies. */
  protected clearLineIssues(): void {
    if (this.lineIssues().size > 0) this.lineIssues.set(new Map());
  }

  protected retryPicker(): void {
    this.pickerRequests.next();
  }

  private itemsChanged(announcement: string): void {
    this.addError.set(null);
    this.itemsIssue.set(null);
    this.lineIssues.set(new Map());
    this.announcement.set(announcement);
  }

  // ---- save ----------------------------------------------------------------------------------

  protected submit(): void {
    if (this.save().kind === 'saving') return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    for (const line of this.lines()) line.quantity.markAsTouched();
    const loaded = this.load();
    if (loaded.kind !== 'ready') return;

    const linesInvalid = this.lines().some((line) => line.quantity.invalid);
    if (this.form.invalid || linesInvalid || this.hasDeletedLine()) {
      this.focusFirstInvalid();
      return;
    }

    const name = this.form.controls.name.value.trim();
    const description = this.form.controls.description.value.trim();
    const deadline = parseDeadline(this.form.controls.deadline.value) ?? '';
    const priority = this.form.controls.priority.value;
    const items: ProjectItemInput[] = this.lines().map((line) => ({
      partId: line.partId,
      // The validator guarantees a whole number; the fallback only satisfies the type.
      quantity: line.quantity.value ?? MIN_QUANTITY,
    }));

    const project = loaded.project;
    if (project === null) {
      const body: CreateProjectRequest = {
        name,
        ...(description === '' ? {} : { description }),
        priority,
        ...(deadline === '' ? {} : { deadline }),
        ...(items.length === 0 ? {} : { items }),
      };
      this.send(this.api.create(body), 'created');
      return;
    }

    const nextDescription = description === '' ? null : description;
    const nextDeadline = deadline === '' ? null : deadline;
    const body: UpdateProjectRequest = {
      version: project.version,
      ...(name === project.name ? {} : { name }),
      // An emptied optional field is sent as null: that is how the API clears it.
      ...(nextDescription === project.description ? {} : { description: nextDescription }),
      ...(priority === project.priority ? {} : { priority }),
      ...(nextDeadline === project.deadline ? {} : { deadline: nextDeadline }),
      ...(sameItems(project, items) ? {} : { items }),
    };
    if (Object.keys(body).length === 1) {
      // Nothing changed: there is nothing to send (the API rejects an empty patch).
      void this.router.navigate(['/proyectos']);
      return;
    }
    this.send(this.api.update(project.id, body), 'updated');
  }

  protected reload(): void {
    this.save.set({ kind: 'idle' });
    this.loadRequests.next();
  }

  private send(request: ReturnType<ProjectsApi['create']>, notice: ProjectsNotice): void {
    this.save.set({ kind: 'saving' });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        void this.router.navigate(['/proyectos'], { state: noticeState(notice) });
      },
      error: (error: unknown) => {
        this.handleSaveError(error);
      },
    });
  }

  private handleSaveError(error: unknown): void {
    if (!(error instanceof ApiError)) {
      this.save.set({ kind: 'failed', message: GENERIC_ERROR, stale: false });
      return;
    }

    if (error.status === 404 && this.projectId !== null) {
      void this.router.navigate(['/proyectos'], { state: noticeState('gone') });
      return;
    }

    if (error.status === 409) {
      this.save.set(
        hasPath(error, 'version')
          ? {
              kind: 'failed',
              stale: true,
              message: 'Alguien más modificó este proyecto. Recargá para ver la versión actual.',
            }
          : {
              kind: 'failed',
              stale: false,
              message:
                'No se pudo guardar por un conflicto con otros datos. Revisalos e intentá de nuevo.',
            },
      );
      return;
    }

    if (error.status === 400 && this.showIssues(error)) {
      this.save.set({ kind: 'idle' });
      this.focusFirstInvalid();
      return;
    }
    this.save.set({ kind: 'failed', message: error.message, stale: false });
  }

  /** Puts each issue next to its control. Returns false when none could be placed. */
  private showIssues(error: ApiError): boolean {
    const lineIssues = new Map<number, string>();
    let itemsIssue: string | null = null;
    let placed = false;

    for (const issue of error.issues) {
      const field = ISSUE_FIELD.get(issue.path);
      const line = LINE_PATH.exec(issue.path);
      if (field !== undefined) {
        this.form.controls[field].setErrors({ server: true });
        placed = true;
      } else if (issue.path === 'items') {
        itemsIssue = ITEMS_ISSUE_MESSAGE;
        placed = true;
      } else if (line !== null) {
        const index = Number(line[1]);
        if (index < this.lines().length && !lineIssues.has(index)) {
          lineIssues.set(index, line[2] === 'quantity' ? QUANTITY_MESSAGE : PART_ISSUE_MESSAGE);
          placed = true;
        }
      }
    }
    this.lineIssues.set(lineIssues);
    this.itemsIssue.set(itemsIssue);
    return placed;
  }

  private populate(project: Project): void {
    this.form.reset({
      name: project.name,
      description: project.description ?? '',
      priority: project.priority,
      deadline: project.deadline === null ? '' : formatDeadline(project.deadline),
    });
    this.lines.set(
      project.items.map((item) => ({
        partId: item.partId,
        name: item.part?.name ?? null,
        quantity: this.fb.control<number | null>(item.quantity, quantityValidator),
      })),
    );
    this.partControl.setValue('');
    this.addQuantity.setValue(1);
    this.submitted.set(false);
    this.lineIssues.set(new Map());
    this.itemsIssue.set(null);
    this.addError.set(null);
    this.announcement.set('');
  }

  private focusFirstInvalid(): void {
    const field = FIELD_ORDER.find((key) => this.form.controls[key].invalid);
    if (field !== undefined) {
      this.focus(`field-${field}`);
      return;
    }
    const lines = this.lines();
    const withProblem = lines.findIndex(
      (line, index) => line.quantity.invalid || this.lineIssues().has(index),
    );
    if (withProblem >= 0) {
      this.focus(`line-qty-${String(withProblem)}`);
      return;
    }
    const deleted = lines.findIndex((line) => line.name === null);
    if (deleted >= 0) this.focus(`line-remove-${String(deleted)}`);
    else if (this.itemsIssue() !== null) this.focus('field-part');
  }

  private focus(id: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus();
  }
}
