import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  input,
  viewChild,
} from '@angular/core';
import type { FormControl } from '@angular/forms';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TEXT_DATE = /^(\d{2})-(\d{2})-(\d{4})$/;

const pad = (value: number, length: number): string => String(value).padStart(length, '0');

/**
 * Calendar and "Hoy" buttons for a date text field written as DD-MM-AAAA. The text field stays the
 * source of truth (and keeps its own validation): these buttons only write into its control, so the
 * date can still be typed. The calendar is the browser's own date picker, opened on a hidden
 * `<input type="date">`; strings are split, never parsed as a `Date` (time-zone shifts, ADR 0011).
 */
@Component({
  selector: 'app-date-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './date-tools.html',
  styleUrl: './date-tools.scss',
})
export class DateTools {
  readonly control = input.required<FormControl<string>>();
  /** What the field is called, for the buttons' accessible names ("fecha límite"). */
  readonly label = input('fecha');

  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  openCalendar(): void {
    const picker = this.picker().nativeElement;
    const match = TEXT_DATE.exec(this.control().value.trim());
    picker.value = match ? `${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}` : '';
    try {
      picker.showPicker();
    } catch {
      // shortcut: a browser without showPicker() just has no calendar; the typed field still works.
    }
  }

  picked(isoDate: string): void {
    const match = ISO_DATE.exec(isoDate);
    if (match) this.write(`${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}`);
  }

  today(now: Date = new Date()): void {
    this.write(
      `${pad(now.getDate(), 2)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getFullYear(), 4)}`,
    );
  }

  private write(text: string): void {
    const control = this.control();
    control.setValue(text);
    control.markAsDirty();
  }
}
