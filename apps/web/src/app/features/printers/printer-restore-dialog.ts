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
 * Asks whether to restore a deleted printer that holds the name just typed (ADR 0009). Same
 * pattern as the delete dialog: native <dialog> with `showModal()`, created only while open.
 */
@Component({
  selector: 'app-printer-restore-dialog',
  templateUrl: './printer-restore-dialog.html',
  styleUrl: './printer-restore-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrinterRestoreDialog {
  readonly printerName = input.required<string>();
  /** True while the restoring request is in flight: both buttons are disabled. */
  readonly busy = input(false);

  readonly confirmed = output();
  readonly cancelled = output();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterNextRender(() => {
      this.dialog().nativeElement.showModal();
      this.cancelButton().nativeElement.focus();
    });
  }

  protected onCancelEvent(event: Event): void {
    // The parent owns the open state: keep the browser from closing the element itself.
    event.preventDefault();
    if (!this.busy()) this.cancelled.emit();
  }

  protected confirm(): void {
    if (!this.busy()) this.confirmed.emit();
  }
}
