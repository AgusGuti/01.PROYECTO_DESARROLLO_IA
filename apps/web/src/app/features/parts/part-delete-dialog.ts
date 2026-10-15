import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { PartUsage } from '@print3d/api-contracts';

/**
 * Confirmation before removing a part. It uses the native <dialog> element: `showModal()` makes
 * the rest of the page inert, traps Tab inside and fires `cancel` when Escape is pressed. The
 * parent creates this component only while it wants the dialog open, and destroys it to close it,
 * so there is no hidden state to keep in sync.
 *
 * It has two modes in one dialog: the plain confirmation, and (when the parent passes `usage`) the
 * "in use" warning that lists the projects the part would be removed from (ADR 0018).
 */
@Component({
  selector: 'app-part-delete-dialog',
  templateUrl: './part-delete-dialog.html',
  styleUrl: './part-delete-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartDeleteDialog {
  private readonly injector = inject(Injector);

  readonly partName = input.required<string>();
  /** True while the DELETE request is in flight: both buttons are disabled. */
  readonly busy = input(false);
  /** Set once the API said live projects use the part: switches the dialog to in-use mode. */
  readonly usage = input<PartUsage | null>(null);

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

    // Switching mode disables the buttons for a moment, which drops the focus: put it back on
    // the safe button once the new content is drawn.
    effect(() => {
      if (this.usage() === null) return;
      afterNextRender(
        () => {
          this.cancelButton().nativeElement.focus();
        },
        { injector: this.injector },
      );
    });
  }

  protected projectsText(usage: PartUsage): string {
    return usage.total === 1 ? '1 proyecto' : `${String(usage.total)} proyectos`;
  }

  protected hiddenCount(usage: PartUsage): number {
    return Math.max(0, usage.total - usage.projects.length);
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
