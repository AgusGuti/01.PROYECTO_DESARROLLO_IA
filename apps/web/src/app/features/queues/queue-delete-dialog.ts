import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * Confirmation before deleting the queue. Native <dialog>: `showModal()` makes the page inert,
 * traps Tab and fires `cancel` on Escape. The parent creates it only while open.
 */
@Component({
  selector: 'app-queue-delete-dialog',
  templateUrl: './queue-delete-dialog.html',
  styleUrl: './queue-delete-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QueueDeleteDialog {
  /** True while the DELETE request is in flight: both buttons are disabled. */
  readonly busy = input(false);

  readonly confirmed = output();
  readonly cancelled = output();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      // The destructive action is never the one the keyboard lands on.
      this.cancelButton().nativeElement.focus();
    });
  }

  protected onCancelEvent(event: Event): void {
    event.preventDefault();
    if (!this.busy()) this.cancelled.emit();
  }

  protected confirm(): void {
    if (!this.busy()) this.confirmed.emit();
  }
}
