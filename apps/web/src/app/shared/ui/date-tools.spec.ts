import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { DateTools } from './date-tools';

@Component({
  imports: [DateTools],
  template: `<app-date-tools [control]="control" label="fecha límite" />`,
})
class Host {
  readonly control = new FormControl('', { nonNullable: true });
}

async function render(initial = '') {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.control.setValue(initial);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const picker = element.querySelector<HTMLInputElement>('input[type="date"]');
  if (!picker) throw new Error('the hidden date picker is missing');
  const button = (label: string) =>
    Array.from(element.querySelectorAll('button')).find((b) => b.textContent.trim() === label);
  return { fixture, element, picker, button, control: fixture.componentInstance.control };
}

describe('DateTools', () => {
  it('"Hoy" writes the local calendar day as DD-MM-AAAA and marks the field dirty', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 5, 23, 30)); // local 5 January, late evening
    try {
      const { button, control } = await render();
      button('Hoy')?.click();
      expect(control.value).toBe('05-01-2026');
      expect(control.dirty).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns the day picked in the calendar (YYYY-MM-DD) into DD-MM-AAAA', async () => {
    const { picker, control } = await render();
    picker.value = '2026-11-30';
    picker.dispatchEvent(new Event('change'));
    expect(control.value).toBe('30-11-2026');
    expect(control.dirty).toBe(true);
  });

  it('ignores a cleared calendar instead of wiping what was typed', async () => {
    const { picker, control } = await render('25-12-2026');
    picker.value = '';
    picker.dispatchEvent(new Event('change'));
    expect(control.value).toBe('25-12-2026');
  });

  it('opens the calendar on the typed day, and on none when the text is not a date', async () => {
    const { picker, button } = await render('25-12-2026');
    const show = vi.fn();
    picker.showPicker = show;
    button('Calendario')?.click();
    expect(picker.value).toBe('2026-12-25');
    expect(show).toHaveBeenCalledOnce();
  });

  it('does not break when the browser cannot open the calendar', async () => {
    const { picker, button } = await render('nonsense');
    picker.showPicker = () => {
      throw new Error('NotAllowedError');
    };
    expect(() => button('Calendario')?.click()).not.toThrow();
    expect(picker.value).toBe('');
  });

  it('gives both buttons accessible names that say which field they act on', async () => {
    const { element } = await render();
    const names = Array.from(element.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['Elegir fecha límite en el calendario', 'Poner la fecha límite de hoy']);
  });
});
