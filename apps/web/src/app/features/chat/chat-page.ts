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
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, map, type Observable, of, Subject, switchMap, tap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { RouterLink } from '@angular/router';
import { ChatApi, type Proposal } from './chat-api';

const MAX_LENGTH = 2000;
const UNAVAILABLE = 'El asistente no está disponible en este momento. Intentá de nuevo más tarde.';
const INVALID = `El mensaje no es válido. Tiene que tener entre 1 y ${MAX_LENGTH} caracteres.`;

const PRIORITY_LABELS = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' } as const;
const REJECTED = 'La API no aceptó la propuesta; revisá los datos en Proyectos.';
// Only a 400 proves nothing was created; any other failure may have created the project.
const UNCERTAIN =
  'No pudimos confirmar si se creó el proyecto. Revisá Proyectos antes de reintentar.';

const REJECTED_QUEUE = 'La API no aceptó la propuesta; revisá los datos.';
const QUEUE_EXISTS = 'Ese proyecto ya tiene una cola.';
const GOAL_LABELS = {
  deadline: 'Cumplir las fechas límite',
  fastest: 'Terminar lo antes posible',
  minimal_idle: 'Minimizar tiempos muertos',
} as const;
const MODE_LABELS = { single: 'Una impresora', multi: 'Varias impresoras' } as const;

interface CardLink {
  readonly commands: readonly string[];
  readonly text: string;
}

/** Everything the card shows, built here from the payload and never from model text. */
interface ProposalView {
  readonly title: string;
  readonly details: readonly string[];
  readonly listTitle: string | null;
  readonly list: readonly string[];
  readonly footnote: string | null;
  readonly sendingText: string;
}

interface ChatMessage {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly proposal?: Proposal;
  readonly view?: ProposalView;
}

/** One card, one confirmation: only `pending` and `failed` accept a click on Confirmar. */
type CardState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'sending' }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly canRetry: boolean;
      readonly link: CardLink | null;
    }
  | { readonly kind: 'created'; readonly text: string; readonly link: CardLink }
  | { readonly kind: 'discarded' };

function proposalView(proposal: Proposal): ProposalView {
  if (proposal.kind === 'create_queue') {
    const { payload, printerNames } = proposal;
    return {
      title: `Crear la cola de impresión del proyecto «${proposal.projectName}»`,
      details: [`Objetivo: ${GOAL_LABELS[payload.goal]}`, `Modo: ${MODE_LABELS[payload.mode]}`],
      listTitle: 'Impresoras:',
      list: payload.printerIds.map(
        (id) => printerNames.find((n) => n.printerId === id)?.name ?? 'Impresora',
      ),
      footnote: 'Las líneas se toman de las piezas del proyecto.',
      sendingText: 'Creando la cola…',
    };
  }
  const { payload, itemNames } = proposal;
  const [year, month, day] = payload.deadline?.split('-') ?? [];
  const details: string[] = [];
  if (payload.description) details.push(`Descripción: ${payload.description}`);
  if (payload.priority) details.push(`Prioridad: ${PRIORITY_LABELS[payload.priority]}`);
  if (payload.deadline) details.push(`Fecha límite: ${day}-${month}-${year}`);
  const items = payload.items ?? [];
  return {
    title: `Crear el proyecto «${payload.name}»`,
    details,
    listTitle: items.length > 0 ? 'Piezas:' : null,
    list: items.map(
      (line) =>
        `${line.quantity} × ${itemNames.find((n) => n.partId === line.partId)?.name ?? 'Pieza'}`,
    ),
    footnote: null,
    sendingText: 'Creando el proyecto…',
  };
}

/** Maps a confirm failure to a fixed card. Only a 400 proves that nothing was created. */
function failureCard(proposal: Proposal, error: unknown): CardState {
  const status = error instanceof ApiError ? error.status : null;
  const isQueue = proposal.kind === 'create_queue';
  if (status === 400) {
    return {
      kind: 'failed',
      message: isQueue ? REJECTED_QUEUE : REJECTED,
      canRetry: true,
      link: null,
    };
  }
  if (isQueue && status === 409) {
    return {
      kind: 'failed',
      message: QUEUE_EXISTS,
      canRetry: false,
      link: { commands: ['/proyectos', proposal.payload.projectId, 'cola'], text: 'Ir a la cola' },
    };
  }
  return {
    kind: 'failed',
    message: UNCERTAIN,
    canRetry: true,
    link: { commands: ['/proyectos'], text: 'Ir a Proyectos' },
  };
}

/** What the conversation is doing right now. A union avoids impossible flag combinations. */
type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'failed'; readonly message: string; readonly retryText: string };

type Outgoing = { readonly text: string } | null; // null = cancel (clear)

@Component({
  selector: 'app-chat-page',
  imports: [RouterLink],
  templateUrl: './chat-page.html',
  styleUrl: './chat-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPage {
  private readonly api = inject(ChatApi);
  private readonly injector = inject(Injector);
  private readonly outgoing = new Subject<Outgoing>();
  private nextId = 0;

  protected readonly maxLength = MAX_LENGTH;
  protected readonly messages = signal<readonly ChatMessage[]>([]);
  protected readonly draft = signal('');
  protected readonly state = signal<ViewState>({ kind: 'idle' });
  protected readonly cards = signal<Readonly<Record<number, CardState>>>({});
  protected readonly announcement = signal('');
  protected readonly confirming = computed(() =>
    Object.values(this.cards()).some((card) => card.kind === 'sending'),
  );
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly canSend = computed(() => {
    const length = this.draft().trim().length;
    return this.state().kind !== 'sending' && length > 0 && length <= MAX_LENGTH;
  });

  protected readonly failedMessage = computed(() => {
    const current = this.state();
    return current.kind === 'failed' ? current.message : '';
  });

  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('input');
  private readonly retryButton = viewChild<ElementRef<HTMLButtonElement>>('retryButton');

  constructor() {
    // `switchMap` unsubscribes from a request in flight (clear, or leaving the page).
    this.outgoing
      .pipe(
        switchMap((item) => {
          if (item === null) return EMPTY;
          return this.api.ask(item.text).pipe(
            tap(({ reply, proposal }) => {
              const added = this.message('assistant', reply, proposal);
              this.messages.update((list) => [...list, added]);
              if (proposal) this.setCard(added.id, { kind: 'pending' });
              this.state.set({ kind: 'idle' });
            }),
            catchError((error: unknown) => {
              this.state.set({
                kind: 'failed',
                message: error instanceof ApiError && error.status === 400 ? INVALID : UNAVAILABLE,
                retryText: item.text,
              });
              afterNextRender(() => this.retryButton()?.nativeElement.focus(), {
                injector: this.injector,
              });
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
  }

  protected send(): void {
    if (!this.canSend()) return;
    const text = this.draft().trim();
    this.messages.update((list) => [...list, this.message('user', text)]);
    this.draft.set('');
    this.submit(text);
    this.input()?.nativeElement.focus();
  }

  protected retry(): void {
    const current = this.state();
    if (current.kind !== 'failed') return;
    this.submit(current.retryText);
    this.input()?.nativeElement.focus();
  }

  protected clear(): void {
    this.outgoing.next(null);
    this.messages.set([]);
    this.cards.set({});
    this.announcement.set('');
    this.state.set({ kind: 'idle' });
    this.input()?.nativeElement.focus();
  }

  protected confirm(message: ChatMessage): void {
    const card = this.cards()[message.id];
    // Single confirmation: a second click, or a click after discard, finds no valid state.
    const proposal = message.proposal;
    if (!proposal || (card?.kind !== 'pending' && card?.kind !== 'failed')) return;
    if (card.kind === 'failed' && !card.canRetry) return;
    this.setCard(message.id, { kind: 'sending' });
    const created$: Observable<CardState> =
      proposal.kind === 'create_queue'
        ? this.api.createQueue(proposal.payload).pipe(
            map(() => ({
              kind: 'created' as const,
              text: 'Cola creada.',
              link: {
                commands: ['/proyectos', proposal.payload.projectId, 'cola'],
                text: 'Abrir la cola',
              },
            })),
          )
        : this.api.createProject(proposal.payload).pipe(
            map((project) => ({
              kind: 'created' as const,
              text: `Proyecto creado: «${project.name}».`,
              link: { commands: ['/proyectos', project.id, 'editar'], text: 'Abrir el proyecto' },
            })),
          );
    created$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (done) => {
        // After "Limpiar conversación" the card is gone: do not resurrect it.
        if (!this.cards()[message.id]) return;
        this.setCard(message.id, done);
        this.announcement.set(done.kind === 'created' ? done.text : '');
        afterNextRender(
          () =>
            this.host.nativeElement
              .querySelector<HTMLElement>(`#proposal-link-${message.id}`)
              ?.focus(),
          { injector: this.injector },
        );
      },
      error: (error: unknown) => {
        if (!this.cards()[message.id]) return;
        const failed = failureCard(proposal, error);
        this.setCard(message.id, failed);
        this.announcement.set(failed.kind === 'failed' ? failed.message : '');
      },
    });
  }

  protected discard(message: ChatMessage): void {
    const kind = this.cards()[message.id]?.kind;
    if (kind !== 'pending' && kind !== 'failed') return;
    this.setCard(message.id, { kind: 'discarded' });
    this.announcement.set('Propuesta descartada.');
    this.input()?.nativeElement.focus();
  }

  private setCard(id: number, card: CardState): void {
    this.cards.update((all) => ({ ...all, [id]: card }));
  }

  private submit(text: string): void {
    this.state.set({ kind: 'sending' });
    this.outgoing.next({ text });
  }

  private message(
    role: ChatMessage['role'],
    text: string,
    proposal?: Proposal | null,
  ): ChatMessage {
    this.nextId += 1;
    const id = this.nextId;
    return proposal
      ? { id, role, text, proposal, view: proposalView(proposal) }
      : { id, role, text };
  }
}
