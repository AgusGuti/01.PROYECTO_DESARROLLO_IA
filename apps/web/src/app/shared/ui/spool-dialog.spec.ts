import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SpoolDialog } from './spool-dialog';

describe('SpoolDialog', () => {
  beforeEach(() => {
    // jsdom does not implement showModal(); this stand-in only marks the dialog as open.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  async function open() {
    const fixture = TestBed.createComponent(SpoolDialog);
    fixture.componentRef.setInput('heading', 'Elegir otra bobina');
    fixture.componentRef.setInput('options', [{ id: 's1', label: 'Una bobina' }]);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('gives each instance its own ids and points the aria attributes at them', async () => {
    const first = await open();
    const second = await open();

    const ids = [first, second].flatMap((host) =>
      Array.from(host.querySelectorAll('[id]')).map((node) => node.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const host of [first, second]) {
      const dialog = host.querySelector('dialog');
      expect(host.querySelector(`#${dialog?.getAttribute('aria-labelledby') ?? ''}`)?.tagName).toBe(
        'H2',
      );
      expect(host.querySelector('label')?.htmlFor).toBe(host.querySelector('select')?.id);
    }
  });
});
