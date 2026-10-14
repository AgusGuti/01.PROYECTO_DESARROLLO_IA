import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PrinterRestoreDialog } from './printer-restore-dialog';

@Component({
  imports: [PrinterRestoreDialog],
  template: `<app-printer-restore-dialog
    [printerName]="name()"
    [busy]="busy()"
    (confirmed)="confirmed = confirmed + 1"
    (cancelled)="cancelled = cancelled + 1"
  />`,
})
class Host {
  readonly name = signal('Ender 3 Pro');
  readonly busy = signal(false);
  confirmed = 0;
  cancelled = 0;
}

describe('PrinterRestoreDialog', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });

  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const byText = (text: string) =>
      Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
    return { fixture, element, byText };
  }

  it('opens as a modal alert dialog that names the printer', async () => {
    const view = await render();

    const dialog = view.element.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('restore-dialog-title');
    expect(dialog?.getAttribute('aria-describedby')).toBe('restore-dialog-text');
    expect(view.element.querySelector('h2')?.textContent).toContain('Restaurar impresora');
    expect(dialog?.textContent).toContain('«Ender 3 Pro»');
  });

  it('puts the initial focus on Cancelar', async () => {
    const view = await render();

    expect(document.activeElement).toBe(view.byText('Cancelar'));
  });

  it('asks the parent to cancel when Cancelar is pressed, without confirming', async () => {
    const view = await render();

    view.byText('Cancelar')?.click();

    expect(view.fixture.componentInstance.cancelled).toBe(1);
    expect(view.fixture.componentInstance.confirmed).toBe(0);
  });

  it('cancels on Escape and keeps the browser from closing the dialog itself', async () => {
    const view = await render();
    const escape = new Event('cancel', { cancelable: true });

    view.element.querySelector('dialog')?.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(view.fixture.componentInstance.cancelled).toBe(1);
  });

  it('emits a confirmation only when Restaurar is pressed', async () => {
    const view = await render();
    expect(view.fixture.componentInstance.confirmed).toBe(0);

    view.byText('Restaurar')?.click();

    expect(view.fixture.componentInstance.confirmed).toBe(1);
  });

  it('disables both buttons and ignores Escape while the request is in flight', async () => {
    const view = await render();

    view.fixture.componentInstance.busy.set(true);
    await view.fixture.whenStable();
    view.element.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(view.byText('Restaurando…')?.disabled).toBe(true);
    expect(view.byText('Cancelar')?.disabled).toBe(true);
    expect(view.fixture.componentInstance.cancelled).toBe(0);
  });
});
