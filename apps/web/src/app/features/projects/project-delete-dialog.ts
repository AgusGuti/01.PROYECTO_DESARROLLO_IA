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
 * Confirmation before removing a project. It uses the native <dialog> element: `showModal()`
 * makes the rest of the page inert, traps Tab inside and fires `cancel` when Escape is pressed.
 * The parent creates this component only while it wants the dialog open, and destroys it to
 * close it, so there is no hidden state to keep in sync.
 */
@Component({
  selector: 'app-project-delete-dialog',
  templateUrl: './project-delete-dialog.html',
  styleUrl: './project-delete-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDeleteDialog {
  readonly projectName = input.required<string>();
  /** True while the DELETE request is in flight: both buttons are disabled. */
  readonly busy = input(false);

  readonly confirmed = output();
  readonly cancelled = output();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      // Safe default: the destructive action is never the one the keyboard lands on.
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
