import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PartUsage } from '@print3d/api-contracts';
import { PartDeleteDialog } from './part-delete-dialog';

@Component({
  imports: [PartDeleteDialog],
  template: `<app-part-delete-dialog
    [partName]="name()"
    [busy]="busy()"
    [usage]="usage()"
    (confirmed)="confirmed = confirmed + 1"
    (cancelled)="cancelled = cancelled + 1"
  />`,
})
class Host {
  readonly name = signal('Soporte de cable');
  readonly busy = signal(false);
  readonly usage = signal<PartUsage | null>(null);
  confirmed = 0;
  cancelled = 0;
}

describe('PartDeleteDialog', () => {
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

  it('opens as a modal alert dialog that names the part and says it is kept', async () => {
    const view = await render();

    const dialog = view.element.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(view.element.querySelector('h2')?.textContent).toContain('Eliminar pieza');
    expect(dialog?.textContent).toContain('«Soporte de cable»');
    expect(dialog?.textContent).toContain('La pieza se quita de las listas pero se conserva');
  });

  it('puts the initial focus on Cancelar, not on the destructive button', async () => {
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

  it('emits a confirmation only when Eliminar is pressed', async () => {
    const view = await render();
    expect(view.fixture.componentInstance.confirmed).toBe(0);

    view.byText('Eliminar')?.click();

    expect(view.fixture.componentInstance.confirmed).toBe(1);
  });

  it('disables both buttons and ignores Escape while the request is in flight', async () => {
    const view = await render();

    view.fixture.componentInstance.busy.set(true);
    await view.fixture.whenStable();
    view.element.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));

    expect(view.byText('Eliminando…')?.disabled).toBe(true);
    expect(view.byText('Cancelar')?.disabled).toBe(true);
    expect(view.fixture.componentInstance.cancelled).toBe(0);
  });

  describe('in-use mode', () => {
    const usage: PartUsage = {
      total: 2,
      projects: [
        { id: 'a', name: 'Taller', quantity: 3 },
        { id: 'b', name: 'Oficina', quantity: 1 },
      ],
    };

    async function renderInUse(value: PartUsage = usage) {
      const view = await render();
      view.fixture.componentInstance.usage.set(value);
      await view.fixture.whenStable();
      return view;
    }

    it('changes the title and lists the projects with their quantities', async () => {
      const view = await renderInUse();

      const dialog = view.element.querySelector('dialog');
      expect(view.element.querySelector('h2')?.textContent).toBe('La pieza está en uso');
      expect(dialog?.textContent).toContain('La pieza «Soporte de cable» se usa en 2 proyectos:');
      const items = Array.from(dialog?.querySelectorAll('li') ?? []).map((li) => li.textContent);
      expect(items).toEqual(['Taller (3 u.)', 'Oficina (1 u.)']);
      expect(dialog?.textContent).toContain(
        'Si continuás, la pieza se quitará de esos proyectos y después se eliminará.',
      );
      expect(dialog?.textContent).not.toContain('se quita de las listas pero se conserva');
    });

    it('uses the singular for a single project and shows no "más" line', async () => {
      const view = await renderInUse({
        total: 1,
        projects: [{ id: 'a', name: 'Taller', quantity: 3 }],
      });

      expect(view.element.querySelector('dialog')?.textContent).toContain('se usa en 1 proyecto:');
      expect(view.element.querySelector('dialog')?.textContent).not.toContain(' más');
    });

    it('says how many more projects there are when the list is shorter than the total', async () => {
      const view = await renderInUse({ total: 53, projects: usage.projects });

      expect(view.element.querySelector('dialog')?.textContent).toContain('y 51 más');
    });

    it('offers Cancelar and the explicit destructive action, with the focus on Cancelar', async () => {
      const view = await renderInUse();

      expect(view.byText('Quitar de los proyectos y eliminar')).toBeDefined();
      expect(view.byText('Eliminar')).toBeUndefined();
      expect(document.activeElement).toBe(view.byText('Cancelar'));
    });

    it('brings the focus back to Cancelar after the buttons were disabled', async () => {
      const view = await render();
      view.fixture.componentInstance.busy.set(true);
      await view.fixture.whenStable();
      (document.activeElement as HTMLElement | null)?.blur();

      view.fixture.componentInstance.busy.set(false);
      view.fixture.componentInstance.usage.set(usage);
      await view.fixture.whenStable();

      expect(document.activeElement).toBe(view.byText('Cancelar'));
    });

    it('emits a confirmation when the destructive action is pressed', async () => {
      const view = await renderInUse();

      view.byText('Quitar de los proyectos y eliminar')?.click();

      expect(view.fixture.componentInstance.confirmed).toBe(1);
    });

    it('disables both buttons while the request is in flight', async () => {
      const view = await renderInUse();

      view.fixture.componentInstance.busy.set(true);
      await view.fixture.whenStable();

      expect(view.byText('Eliminando…')?.disabled).toBe(true);
      expect(view.byText('Cancelar')?.disabled).toBe(true);
    });

    it('renders hostile project names as text', async () => {
      const view = await renderInUse({
        total: 1,
        projects: [{ id: 'a', name: '<img src=x onerror=alert(1)>', quantity: 1 }],
      });

      expect(view.element.querySelector('img')).toBeNull();
      expect(view.element.querySelector('li')?.textContent).toContain('<img src=x');
    });
  });

  it('renders a hostile part name as text', async () => {
    const view = await render();

    view.fixture.componentInstance.name.set('<img src=x onerror=alert(1)>');
    await view.fixture.whenStable();

    expect(view.element.querySelector('img')).toBeNull();
    expect(view.element.querySelector('dialog')?.textContent).toContain('<img src=x');
  });
});
