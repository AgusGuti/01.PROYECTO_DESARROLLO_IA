import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  input,
  output,
  viewChild,
  afterNextRender,
} from '@angular/core';

/**
 * Confirmation before removing a printer. It uses the native <dialog> element: `showModal()`
 * makes the rest of the page inert, traps Tab inside and fires `cancel` when Escape is pressed.
 * The parent creates this component only while it wants the dialog open, and destroys it to
 * close it, so there is no hidden state to keep in sync.
 */
@Component({
  selector: 'app-printer-delete-dialog',
  templateUrl: './printer-delete-dialog.html',
  styleUrl: './printer-delete-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrinterDeleteDialog {
  readonly printerName = input.required<string>();
  /** The printer is marked "En uso": deleting it only archives it, so the dialog says so. */
  readonly inUse = input(false);
  /** True while the DELETE request is in flight: the confirm button is disabled. */
  readonly busy = input(false);

  readonly confirmed = output();
  readonly cancelled = output();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      // Safe default: the destructive action is never the one under the cursor of the keyboard.
      this.cancelButton().nativeElement.focus();
    });
  }

  protected onCancelEvent(event: Event): void {
    // Stop the browser from closing the element itself; the parent owns the open state.
    event.preventDefault();
    if (!this.busy()) this.cancelled.emit();
  }

  protected confirm(): void {
    if (!this.busy()) this.confirmed.emit();
  }
}
