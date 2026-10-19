import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  Optimization,
  Simulation,
  SimulationRequest,
  SimulationWarningCode,
} from '@print3d/api-contracts';
import { catchError, map, type Observable, of, startWith, Subject, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import {
  DEADLINE_CHANGE_TEXT,
  deadlineText,
  dayStart,
  defaultStart,
  finishDeltaText,
  formatDateTime,
  formatMinutes,
  GOAL_LABELS,
  HORIZON_DAYS,
  idleDeltaText,
  parseDate,
  parseTime,
  STRATEGY_LABELS,
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

type Mode = 'simulate' | 'optimize';

interface RunRequest {
  readonly mode: Mode;
  readonly startAt: string;
}

type RunState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly mode: Mode }
  | { readonly kind: 'noQueue' }
  | { readonly kind: 'failed'; readonly message: string; readonly queueLink?: boolean }
  | { readonly kind: 'done'; readonly simulation: Simulation; readonly printers: PrinterView[] }
  | {
      readonly kind: 'optimized';
      readonly optimization: Optimization;
      readonly printers: PrinterView[];
    };

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intentá de nuevo.';
const HORIZON_MINUTES = HORIZON_DAYS * 24 * 60;
const MIN_BAR = 0.4;
const IDLE: RunState = { kind: 'idle' };
const DATE_MESSAGE =
  'Ingresá una fecha real con el formato DD-MM-AAAA, entre los años 2000 y 2099.';
const TIME_MESSAGE = 'Ingresá una hora entre 00:00 y 23:59 con el formato HH:MM.';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

interface TimedJob {
  readonly order: number;
  readonly printerId: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly handoffAt: string;
  readonly unattended: boolean;
}

/** Rows and timeline bars per printer; `describe` words the piece of each job. */
function buildPrinters<J extends TimedJob>(
  startAt: string,
  printers: readonly {
    printerId: string;
    name: string;
    jobs: number;
    busyMinutes: number;
    idleMinutes: number;
  }[],
  jobs: readonly J[],
  describe: (job: J) => string,
): PrinterView[] {
  const origin = wallMinutes(startAt);
  return printers.map((printer) => ({
    id: printer.printerId,
    name: printer.name,
    summary: `${String(printer.jobs)} trabajo(s) · ocupada ${formatMinutes(printer.busyMinutes)} · tiempo muerto ${formatMinutes(printer.idleMinutes)}`,
    jobs: jobs
      .filter((job) => job.printerId === printer.printerId)
      .map((job) => {
        const left = clamp(((wallMinutes(job.startAt) - origin) / HORIZON_MINUTES) * 100, 0, 100);
        const length =
          ((wallMinutes(job.handoffAt) - wallMinutes(job.startAt)) / HORIZON_MINUTES) * 100;
        const part = describe(job);
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

const piecesPerPlate = (units: number): string =>
  `${String(units)} ${units === 1 ? 'pieza' : 'piezas'} por placa`;

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
  imports: [NgTemplateOutlet, ReactiveFormsModule, RouterLink],
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

  /** A request runs a simulation or an optimisation; `null` clears the result (an input changed). */
  private readonly runs = new Subject<RunRequest | null>();

  // `switchMap` cancels the run still in flight when a new one starts or the inputs change.
  protected readonly run = toSignal(
    this.runs.pipe(
      switchMap((request) => {
        const id = this.projectId;
        if (request === null) return of<RunState>(IDLE);
        if (id === null) return of<RunState>({ kind: 'failed', message: GENERIC_ERROR });
        const body: SimulationRequest = { projectId: id, startAt: request.startAt };
        return this.execute(request.mode, body).pipe(
          catchError((error: unknown) => of(failureOf(error))),
          startWith<RunState>({ kind: 'running', mode: request.mode }),
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

  protected readonly presets = [
    { label: 'Hoy', days: 0 },
    { label: 'Mañana', days: 1 },
    { label: 'En una semana', days: 7 },
  ] as const;

  /** "Retomar desde": the Argentina date at 00:00. Changing the form clears any result. */
  protected resumeFrom(days: number): void {
    this.form.setValue(dayStart(Date.now(), days));
  }

  private execute(mode: Mode, body: SimulationRequest): Observable<RunState> {
    if (mode === 'optimize') {
      return this.api.optimize(body).pipe(
        map((optimization): RunState => ({
          kind: 'optimized',
          optimization,
          printers: buildPrinters(
            optimization.startAt,
            optimization.optimized.printers,
            optimization.optimized.jobs,
            (job) =>
              `${job.partName}: ${piecesPerPlate(job.units)} (placa ${String(job.plateIndex)} de ${String(job.platesInLine)})`,
          ),
        })),
      );
    }
    return this.api.simulate(body).pipe(
      map((simulation): RunState => ({
        kind: 'done',
        simulation,
        printers: buildPrinters(
          simulation.startAt,
          simulation.printers,
          simulation.jobs,
          (job) => `${job.partName} (${String(job.unit)} de ${String(job.unitsInLine)})`,
        ),
      })),
    );
  }

  /** The only text announced by the live region. */
  protected statusText(state: RunState): string {
    if (state.kind === 'running') {
      return state.mode === 'optimize' ? 'Optimizando…' : 'Simulando…';
    }
    if (state.kind === 'optimized') {
      return `Optimización lista: ${STRATEGY_LABELS[state.optimization.strategy]}`;
    }
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
  protected deadlineText = deadlineText;
  protected strategyLabel = STRATEGY_LABELS;

  protected explanation(optimization: Optimization): string {
    return `Probamos ${String(optimization.candidates.length)} estrategias y elegimos la mejor según el objetivo: ${GOAL_LABELS[optimization.goal]}.`;
  }

  protected deltaLines(optimization: Optimization): string[] {
    const { finishDeltaMinutes, idleDeltaMinutes, deadlineChanged } = optimization.comparison;
    return [
      finishDeltaText(finishDeltaMinutes),
      idleDeltaText(idleDeltaMinutes),
      DEADLINE_CHANGE_TEXT[deadlineChanged],
    ];
  }

  protected finishText(finishAt: string | null): string {
    return finishAt === null ? 'Sin trabajos ubicados' : formatDateTime(finishAt);
  }

  protected candidateDeadline(met: boolean | null): string {
    if (met === null) return 'No aplica';
    return met ? 'Cumple' : 'No cumple';
  }

  /** The two columns of the side-by-side comparison, one row per figure. */
  protected comparisonRows(
    optimization: Optimization,
  ): readonly { label: string; baseline: string; optimized: string }[] {
    const { baseline, optimized } = optimization;
    const both = (
      label: string,
      pick: (plan: Optimization['baseline']) => string,
    ): { label: string; baseline: string; optimized: string } => ({
      label,
      baseline: pick(baseline),
      optimized: pick(optimized),
    });
    return [
      both('Hora de fin', (plan) => this.finishText(plan.totals.finishAt)),
      both('Tiempo ocupado', (plan) => formatMinutes(plan.totals.totalBusyMinutes)),
      both('Tiempo muerto', (plan) => formatMinutes(plan.totals.totalIdleMinutes)),
      both('Piezas ubicadas', (plan) => String(plan.totals.placedUnits)),
      both('Piezas no ubicadas', (plan) => String(plan.totals.unplacedUnits)),
      both('Placas impresas', (plan) => String(plan.totals.placedPlates)),
      both('Fecha límite', (plan) => deadlineText(plan.deadline)),
    ];
  }

  protected launch(mode: Mode): void {
    this.submitted.set(true);
    const date = parseDate(this.form.controls.date.value);
    const time = parseTime(this.form.controls.time.value);
    if (date === null || time === null) {
      const target = date === null ? '#sim-date' : '#sim-time';
      this.host.nativeElement.querySelector<HTMLElement>(target)?.focus();
      return;
    }
    this.runs.next({ mode, startAt: `${date}T${time}` });
  }
}
