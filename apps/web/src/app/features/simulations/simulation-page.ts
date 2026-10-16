import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Simulation, SimulationWarningCode } from '@print3d/api-contracts';
import { catchError, map, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import {
  defaultStart,
  formatDate,
  formatDateTime,
  formatMinutes,
  HORIZON_DAYS,
  parseDate,
  parseTime,
  wallMinutes,
  WARNING_MESSAGES,
} from './simulation-labels';
import { SimulationsApi } from './simulations-api';

interface JobRow {
  readonly order: number;
  readonly part: string;
  readonly start: string;
  readonly end: string;
  readonly handoff: string;
  readonly unattended: boolean;
  /** Position and length of the timeline bar, as percentages of the horizon. */
  readonly left: number;
  readonly width: number;
  readonly title: string;
}

interface PrinterView {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly jobs: readonly JobRow[];
}

type RunState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'noQueue' }
  | { readonly kind: 'failed'; readonly message: string; readonly queueLink?: boolean }
  | { readonly kind: 'done'; readonly simulation: Simulation; readonly printers: PrinterView[] };

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const HORIZON_MINUTES = HORIZON_DAYS * 24 * 60;
const MIN_BAR = 0.4;
const IDLE: RunState = { kind: 'idle' };
const DATE_MESSAGE =
  'Ingresá una fecha real con el formato DD-MM-AAAA, entre los años 2000 y 2099.';
const TIME_MESSAGE = 'Ingresá una hora entre 00:00 y 23:59 con el formato HH:MM.';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function buildPrinters(simulation: Simulation): PrinterView[] {
  const origin = wallMinutes(simulation.startAt);
  return simulation.printers.map((printer) => ({
    id: printer.printerId,
    name: printer.name,
    summary: `${String(printer.jobs)} trabajo(s) · ocupada ${formatMinutes(printer.busyMinutes)} · tiempo muerto ${formatMinutes(printer.idleMinutes)}`,
    jobs: simulation.jobs
      .filter((job) => job.printerId === printer.printerId)
      .map((job) => {
        const left = clamp(((wallMinutes(job.startAt) - origin) / HORIZON_MINUTES) * 100, 0, 100);
        const length =
          ((wallMinutes(job.handoffAt) - wallMinutes(job.startAt)) / HORIZON_MINUTES) * 100;
        const part = `${job.partName} (${String(job.unit)} de ${String(job.unitsInLine)})`;
        return {
          order: job.order,
          part,
          start: formatDateTime(job.startAt),
          end: formatDateTime(job.endAt),
          handoff: formatDateTime(job.handoffAt),
          unattended: job.unattended,
          left,
          width: clamp(length, MIN_BAR, 100 - left),
          title: `${part}: ${formatDateTime(job.startAt)} a ${formatDateTime(job.handoffAt)}`,
        };
      }),
  }));
}

function failureOf(error: unknown): RunState {
  if (!(error instanceof ApiError)) return { kind: 'failed', message: GENERIC_ERROR };
  // The API answers 400 on projectId when the project has no queue (or no longer exists).
  if (error.status === 400 && error.issues.some((issue) => issue.path === 'projectId')) {
    return { kind: 'noQueue' };
  }
  const has = (path: string): boolean =>
    error.status === 400 && error.issues.some((issue) => issue.path === path);
  if (has('lines')) {
    return {
      kind: 'failed',
      message: 'Hay demasiadas unidades pendientes para simular. Reducí la cola.',
    };
  }
  if (has('printerIds')) {
    return {
      kind: 'failed',
      message: 'Ninguna de las impresoras elegidas está disponible. Elegí otras en la cola.',
      queueLink: true,
    };
  }
  if (has('startAt')) {
    return { kind: 'failed', message: 'La fecha y la hora de inicio no son válidas. Revisalas.' };
  }
  return { kind: 'failed', message: error.message };
}

@Component({
  selector: 'app-simulation-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './simulation-page.html',
  styleUrl: './simulation-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimulationPage {
  private readonly api = inject(SimulationsApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly projectId = inject(ActivatedRoute).snapshot.paramMap.get('id');

  protected readonly horizonDays = HORIZON_DAYS;
  // One reading of the clock, so date and time can never straddle midnight.
  private readonly start = defaultStart(Date.now());
  protected readonly form = this.fb.group({
    date: this.fb.control(this.start.date),
    time: this.fb.control(this.start.time),
  });
  protected readonly submitted = signal(false);

  /** A start text runs a simulation; `null` clears the result (an input changed). */
  private readonly runs = new Subject<string | null>();

  // `switchMap` cancels the run still in flight when a new one starts or the inputs change.
  protected readonly run = toSignal(
    this.runs.pipe(
      switchMap((startAt) => {
        const id = this.projectId;
        if (startAt === null) return of<RunState>(IDLE);
        if (id === null) return of<RunState>({ kind: 'failed', message: GENERIC_ERROR });
        return this.api.simulate({ projectId: id, startAt }).pipe(
          map((simulation): RunState => ({
            kind: 'done',
            simulation,
            printers: buildPrinters(simulation),
          })),
          catchError((error: unknown) => of(failureOf(error))),
          startWith<RunState>({ kind: 'running' }),
        );
      }),
    ),
    { initialValue: IDLE },
  );

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.runs.next(null);
    });
  }

  /** The only text announced by the live region. */
  protected statusText(state: RunState): string {
    if (state.kind === 'running') return 'Simulando…';
    if (state.kind !== 'done') return '';
    return `Simulación lista: ${String(state.simulation.totals.placedJobs)} trabajos ubicados`;
  }

  protected dateError(): string | null {
    const control = this.form.controls.date;
    if (!(control.dirty || this.submitted())) return null;
    return parseDate(control.value) === null ? DATE_MESSAGE : null;
  }

  protected timeError(): string | null {
    const control = this.form.controls.time;
    if (!(control.dirty || this.submitted())) return null;
    return parseTime(control.value) === null ? TIME_MESSAGE : null;
  }

  protected warningText = (code: SimulationWarningCode): string => WARNING_MESSAGES[code];
  protected formatMinutes = formatMinutes;
  protected formatDateTime = formatDateTime;

  protected deadlineText(simulation: Simulation): string {
    const { date, met } = simulation.deadline;
    if (date === null) return 'Sin fecha límite';
    if (met === null) return `${formatDate(date)}: sin trabajos ubicados para evaluar`;
    return `${formatDate(date)}: ${met ? 'cumple' : 'no cumple'}`;
  }

  protected submit(): void {
    this.submitted.set(true);
    const date = parseDate(this.form.controls.date.value);
    const time = parseTime(this.form.controls.time.value);
    if (date === null || time === null) {
      const target = date === null ? '#sim-date' : '#sim-time';
      this.host.nativeElement.querySelector<HTMLElement>(target)?.focus();
      return;
    }
    this.runs.next(`${date}T${time}`);
  }
}
