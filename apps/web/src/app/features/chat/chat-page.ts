import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, of, Subject, switchMap, tap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { ChatApi } from './chat-api';

const MAX_LENGTH = 2000;
const UNAVAILABLE = 'El asistente no está disponible en este momento. Intentá de nuevo más tarde.';
const INVALID = `El mensaje no es válido. Tiene que tener entre 1 y ${MAX_LENGTH} caracteres.`;

interface ChatMessage {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** What the conversation is doing right now. A union avoids impossible flag combinations. */
type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'failed'; readonly message: string; readonly retryText: string };

type Outgoing = { readonly text: string } | null; // null = cancel (clear)

@Component({
  selector: 'app-chat-page',
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
            tap((reply) => {
              this.messages.update((list) => [...list, this.message('assistant', reply)]);
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
    this.state.set({ kind: 'idle' });
    this.input()?.nativeElement.focus();
  }

  private submit(text: string): void {
    this.state.set({ kind: 'sending' });
    this.outgoing.next({ text });
  }

  private message(role: ChatMessage['role'], text: string): ChatMessage {
    this.nextId += 1;
    return { id: this.nextId, role, text };
  }
}
