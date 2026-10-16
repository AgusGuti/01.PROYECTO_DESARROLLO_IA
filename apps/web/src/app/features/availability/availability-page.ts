import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type {
  InterventionRange,
  InterventionSchedule,
  UpdateScheduleRequest,
} from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AvailabilityApi } from './availability-api';
import {
  DAY_NAMES,
  formatDay,
  formatMinutes,
  MAX_EXCEPTIONS,
  MAX_RANGES_PER_DAY,
  parseDay,
  parseTime,
} from './availability-labels';
import { type RangeGroup, RangesEditor } from './ranges-editor';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly schedule: InterventionSchedule }
  | { readonly kind: 'failed'; readonly message: string };

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  /** `stale` means someone else saved first: the page offers to reload. */
  | { readonly kind: 'failed'; readonly message: string; readonly stale: boolean };

type DayGroup = FormGroup<{ ranges: FormArray<RangeGroup> }>;
type ExceptionGroup = FormGroup<{ date: FormControl<string>; ranges: FormArray<RangeGroup> }>;

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const INITIAL_LOAD: LoadState = { kind: 'loading' };

const START_MESSAGE = 'Escribí la hora con formato HH:MM, por ejemplo 08:00.';
const END_MESSAGE =
  'Escribí la hora con formato HH:MM, por ejemplo 18:00 (24:00 es el fin del día).';
const ORDER_MESSAGE = 'El «Hasta» tiene que ser posterior al «Desde».';
const OVERLAP_MESSAGE = 'Este rango se superpone con otro del mismo día.';
const DATE_MESSAGE = 'Escribí una fecha real con formato DD-MM-AAAA, entre 2000 y 2099.';
const DUPLICATE_MESSAGE = 'Esta fecha está repetida.';
const TOO_MANY_RANGES = 'Un día admite hasta 6 rangos.';

/** Which control an API issue path belongs to; the id is that of the control to mark. */
const ISSUE_PATH =
  /^(weekly|exceptions)\.(\d+)(?:\.(date)|\.ranges(?:\.(\d+)(?:\.(startMinute|endMinute))?)?)?$/;

function issueTarget(path: string): string | null {
  if (path === 'exceptions') return 'x-add';
  const match = ISSUE_PATH.exec(path);
  if (match === null) return null;
  const [, section, index, date, range, edge] = match;
  const prefix = `${section === 'weekly' ? 'w' : 'x'}-${index ?? ''}`;
  if (date !== undefined) return section === 'exceptions' ? `${prefix}-date` : null;
  if (range === undefined) return `${prefix}-add`;
  return `${prefix}-${range}-${edge === 'endMinute' ? 'end' : 'start'}`;
}

function serverMessage(id: string): string {
  if (id === 'x-add') return 'Hay demasiadas excepciones.';
  if (id.endsWith('-date')) return 'La fecha no es válida o está repetida.';
  if (id.endsWith('-add')) return 'Revisá los rangos de este día.';
  return 'Este horario no es válido o se superpone con otro.';
}

function newRange(start: string, end: string): RangeGroup {
  return new FormGroup({
    start: new FormControl(start, { nonNullable: true }),
    end: new FormControl(end, { nonNullable: true }),
  });
}

function rangesOf(ranges: readonly InterventionRange[]): FormArray<RangeGroup> {
  return new FormArray(
    ranges.map((range) =>
      newRange(formatMinutes(range.startMinute), formatMinutes(range.endMinute)),
    ),
  );
}

/**
 * Checks what the user typed in one list of ranges and returns the minutes, or null when
 * something is wrong (then `errors` says where). Mirrors the API rules as a convenience.
 */
function readRanges(
  array: FormArray<RangeGroup>,
  prefix: string,
  errors: Record<string, string>,
): InterventionRange[] | null {
  const parsed: { range: InterventionRange; index: number }[] = [];
  array.controls.forEach((group, index) => {
    const raw = group.getRawValue();
    const startMinute = parseTime(raw.start, false);
    const endMinute = parseTime(raw.end, true);
    if (startMinute === null) errors[`${prefix}-${index}-start`] = START_MESSAGE;
    if (endMinute === null) errors[`${prefix}-${index}-end`] = END_MESSAGE;
    if (startMinute === null || endMinute === null) return;
    if (startMinute >= endMinute) {
      errors[`${prefix}-${index}-end`] = ORDER_MESSAGE;
      return;
    }
    parsed.push({ range: { startMinute, endMinute }, index });
  });
  if (array.length > MAX_RANGES_PER_DAY) errors[`${prefix}-add`] = TOO_MANY_RANGES;

  parsed.sort((a, b) => a.range.startMinute - b.range.startMinute);
  parsed.forEach((item, position) => {
    const before = parsed[position - 1];
    if (before !== undefined && item.range.startMinute < before.range.endMinute) {
      errors[`${prefix}-${item.index}-start`] = OVERLAP_MESSAGE;
    }
  });
  return parsed.length === array.length ? parsed.map((item) => item.range) : null;
}

@Component({
  selector: 'app-availability-page',
  imports: [ReactiveFormsModule, RangesEditor],
  templateUrl: './availability-page.html',
  styleUrl: './availability-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvailabilityPage {
  private readonly api = inject(AvailabilityApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly dayNames = DAY_NAMES;
  protected readonly maxExceptions = MAX_EXCEPTIONS;

  protected readonly weekly = new FormArray<DayGroup>(
    DAY_NAMES.map(() => new FormGroup({ ranges: rangesOf([]) })),
  );
  protected readonly exceptions = new FormArray<ExceptionGroup>([]);
  private readonly form = new FormGroup({ weekly: this.weekly, exceptions: this.exceptions });

  protected readonly save = signal<SaveState>({ kind: 'idle' });
  /** The text announced to screen readers: saved, copied, added, removed. */
  protected readonly announcement = signal('');
  /** Error text by control id; empty when everything is fine. */
  protected readonly errors = signal<Readonly<Record<string, string>>>({});
  private readonly submitted = signal(false);
  /** The schedule returned by the last successful save: it carries the newest version. */
  private readonly saved = signal<InterventionSchedule | null>(null);

  private readonly loadRequests = new Subject<void>();

  /** Loads the schedule; `switchMap` drops a superseded load (a second "Recargar"). */
  protected readonly load = toSignal(
    this.loadRequests.pipe(
      startWith(undefined),
      switchMap(() =>
        this.api.getSchedule().pipe(
          map((schedule): LoadState => {
            this.populate(schedule);
            return { kind: 'ready', schedule };
          }),
          catchError((error: unknown) =>
            of<LoadState>({
              kind: 'failed',
              message: error instanceof ApiError ? error.message : GENERIC_ERROR,
            }),
          ),
          startWith<LoadState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: INITIAL_LOAD },
  );

  /** The version the next save must send: that of the last save, else the loaded one. */
  private readonly currentVersion = computed(() => {
    const saved = this.saved();
    if (saved !== null) return saved.version;
    const loaded = this.load();
    return loaded.kind === 'ready' ? loaded.schedule.version : 0;
  });

  /** True until the first save: the API answers the defaults with version 0. */
  protected readonly neverSaved = computed(() => {
    const loaded = this.load();
    return loaded.kind === 'ready' && this.saved() === null && loaded.schedule.version === 0;
  });

  constructor() {
    // After a failed attempt, keep the messages in step with what the user fixes.
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.submitted()) this.errors.set(this.validate().errors);
    });
  }

  protected exceptionName(index: number): string {
    return `Excepción ${index + 1}`;
  }

  protected addRange(array: FormArray<RangeGroup>, prefix: string, name: string): void {
    array.push(newRange('08:00', '18:00'));
    this.announcement.set(`Rango agregado a ${name}.`);
    this.focusLater(`${prefix}-${array.length - 1}-start`);
  }

  protected removeRange(
    array: FormArray<RangeGroup>,
    index: number,
    prefix: string,
    name: string,
  ): void {
    array.removeAt(index);
    this.announcement.set(`Rango quitado de ${name}.`);
    this.focusLater(`${prefix}-add`);
  }

  /** Puts the ranges typed for one day on the other six. */
  protected copyToAll(dayIndex: number): void {
    const source = this.weekly.at(dayIndex).controls.ranges.getRawValue();
    this.weekly.controls.forEach((day, index) => {
      if (index === dayIndex) return;
      day.controls.ranges.clear();
      for (const range of source) day.controls.ranges.push(newRange(range.start, range.end));
    });
    this.announcement.set(`Copiaste los rangos de ${DAY_NAMES[dayIndex] ?? ''} a todos los días.`);
  }

  protected addException(): void {
    if (this.exceptions.length >= MAX_EXCEPTIONS) return;
    this.exceptions.push(
      new FormGroup({ date: new FormControl('', { nonNullable: true }), ranges: rangesOf([]) }),
    );
    this.announcement.set('Excepción agregada.');
    this.focusLater(`x-${this.exceptions.length - 1}-date`);
  }

  protected removeException(index: number): void {
    this.exceptions.removeAt(index);
    this.announcement.set('Excepción quitada.');
    this.focusLater('x-add');
  }

  protected submit(): void {
    if (this.save().kind === 'saving') return;
    this.submitted.set(true);
    this.announcement.set('');
    if (this.load().kind !== 'ready') return;

    const { errors, body } = this.validate();
    this.errors.set(errors);
    if (body === null) {
      this.focusFirstInvalid();
      return;
    }

    this.save.set({ kind: 'saving' });
    this.api
      .putSchedule(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (schedule) => {
          this.saved.set(schedule);
          this.save.set({ kind: 'idle' });
          this.announcement.set('Disponibilidad guardada.');
        },
        error: (error: unknown) => {
          this.handleSaveError(error);
        },
      });
  }

  /** Discards what is typed and reads the schedule again, with its newest version. */
  protected reload(): void {
    this.save.set({ kind: 'idle' });
    this.announcement.set('');
    this.saved.set(null);
    this.loadRequests.next();
  }

  /** Reads the form into the request body, or says which controls are wrong. */
  private validate(): { errors: Record<string, string>; body: UpdateScheduleRequest | null } {
    const errors: Record<string, string> = {};
    const weekly = this.weekly.controls.map((day, index) =>
      readRanges(day.controls.ranges, `w-${index}`, errors),
    );

    const seen = new Set<string>();
    const exceptions = this.exceptions.controls.map((row, index) => {
      const date = parseDay(row.controls.date.value);
      if (date === null) errors[`x-${index}-date`] = DATE_MESSAGE;
      else if (seen.has(date)) errors[`x-${index}-date`] = DUPLICATE_MESSAGE;
      else seen.add(date);
      return { date, ranges: readRanges(row.controls.ranges, `x-${index}`, errors) };
    });

    const days = weekly.filter((ranges) => ranges !== null).map((ranges) => ({ ranges }));
    const rows = exceptions.flatMap((row) =>
      row.date !== null && row.ranges !== null ? [{ date: row.date, ranges: row.ranges }] : [],
    );
    const valid =
      Object.keys(errors).length === 0 && days.length === 7 && rows.length === exceptions.length;
    return {
      errors,
      body: valid ? { weekly: days, exceptions: rows, version: this.currentVersion() } : null,
    };
  }

  private handleSaveError(error: unknown): void {
    if (!(error instanceof ApiError)) {
      this.save.set({ kind: 'failed', message: GENERIC_ERROR, stale: false });
      return;
    }

    if (error.status === 409 && error.issues.some((issue) => issue.path === 'version')) {
      this.save.set({
        kind: 'failed',
        stale: true,
        message:
          'Alguien modificó tu disponibilidad mientras la editabas. Recargá para ver los valores actuales; tus cambios sin guardar se van a perder.',
      });
      return;
    }

    this.save.set({ kind: 'failed', message: error.message, stale: false });
    if (error.status === 400) {
      const marked: Record<string, string> = {};
      for (const issue of error.issues) {
        const id = issueTarget(issue.path);
        if (id !== null) marked[id] = serverMessage(id);
      }
      if (Object.keys(marked).length > 0) {
        this.errors.set(marked);
        this.focusFirstInvalid();
      }
    }
  }

  private populate(schedule: InterventionSchedule): void {
    this.weekly.controls.forEach((day, index) => {
      const ranges = day.controls.ranges;
      ranges.clear();
      for (const range of schedule.weekly[index]?.ranges ?? []) {
        ranges.push(newRange(formatMinutes(range.startMinute), formatMinutes(range.endMinute)));
      }
    });
    this.exceptions.clear();
    for (const item of schedule.exceptions) {
      this.exceptions.push(
        new FormGroup({
          date: new FormControl(formatDay(item.date), { nonNullable: true }),
          ranges: rangesOf(item.ranges),
        }),
      );
    }
    this.submitted.set(false);
    this.errors.set({});
  }

  private focusFirstInvalid(): void {
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  private focusLater(id: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(`#${id}`)?.focus();
      },
      { injector: this.injector },
    );
  }
}
