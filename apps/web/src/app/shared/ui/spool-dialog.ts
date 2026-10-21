import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

/** One choice in the dialog. A disabled one is shown but cannot be picked. */
export interface SpoolOption {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

/** "Brand · Colour · Material · 750 g disponibles": the text of a spool in a select. */
export function spoolLabel(spool: {
  readonly brand: string;
  readonly colorName: string;
  readonly material: string;
  readonly availableGrams: number;
}): string {
  return `${spool.brand} · ${spool.colorName} · ${spool.material} · ${String(spool.availableGrams)} g disponibles`;
}

/**
 * Asks the user to pick another spool (ADR 0036). Native <dialog>: `showModal()` makes the page
 * inert, traps Tab and fires `cancel` on Escape. The parent creates it only while open and puts the
 * focus back where it was when `cancelled` or `picked` fires. There is always a way out: Cancelar,
 * Escape, or the link to create a spool.
 */
@Component({
  selector: 'app-spool-dialog',
  imports: [RouterLink],
  templateUrl: './spool-dialog.html',
  styleUrl: './spool-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpoolDialog {
  readonly heading = input.required<string>();
  readonly intro = input('');
  readonly confirmLabel = input('Elegir bobina');
  readonly options = input.required<readonly SpoolOption[]>();

  readonly picked = output<string>();
  readonly cancelled = output();

  protected readonly missing = signal(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly select = viewChild<ElementRef<HTMLSelectElement>>('select');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      (this.select() ?? this.cancelButton()).nativeElement.focus();
    });
  }

  protected onCancelEvent(event: Event): void {
    event.preventDefault();
    this.cancelled.emit();
  }

  protected confirm(): void {
    const value = this.select()?.nativeElement.value ?? '';
    if (value === '') {
      this.missing.set(true);
      return;
    }
    this.picked.emit(value);
  }
}
