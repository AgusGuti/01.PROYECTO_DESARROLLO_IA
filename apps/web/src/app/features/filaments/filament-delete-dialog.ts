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
 * Confirmation before removing a filament. It uses the native <dialog> element: `showModal()`
 * makes the rest of the page inert, traps Tab inside and fires `cancel` when Escape is pressed.
 * The parent creates this component only while it wants the dialog open, and destroys it to
 * close it, so there is no hidden state to keep in sync.
 */
@Component({
  selector: 'app-filament-delete-dialog',
  templateUrl: './filament-delete-dialog.html',
  styleUrl: './filament-delete-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilamentDeleteDialog {
  readonly filamentName = input.required<string>();
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
