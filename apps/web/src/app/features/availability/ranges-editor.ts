import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  type FormArray,
  type FormControl,
  type FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { MAX_RANGES_PER_DAY } from './availability-labels';

/** One range as the user types it: two "HH:MM" texts. */
export type RangeGroup = FormGroup<{
  start: FormControl<string>;
  end: FormControl<string>;
}>;

/**
 * The ranges of one day (or of one exception): a list of "Desde / Hasta" pairs with "Quitar" and
 * "Agregar rango". It only draws; the parent owns the form, the validation and the focus.
 * Control ids are `<prefix>-<n>-start|end` and `<prefix>-add`, which the parent uses to focus.
 */
@Component({
  selector: 'app-ranges-editor',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ranges-editor.scss',
  template: `
    @for (range of ranges().controls; track $index; let r = $index) {
      @let startId = prefix() + '-' + r + '-start';
      @let endId = prefix() + '-' + r + '-end';
      @let startError = errors()[startId];
      @let endError = errors()[endId];
      <div class="range" role="group" [attr.aria-label]="name() + ', rango ' + (r + 1)">
        <div class="field">
          <label [for]="startId"
            >Desde <span class="visually-hidden">({{ name() }}, rango {{ r + 1 }})</span></label
          >
          <input
            [id]="startId"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="08:00"
            [formControl]="range.controls.start"
            [attr.aria-invalid]="startError ? 'true' : null"
            [attr.aria-describedby]="startError ? startId + '-error' : null"
          />
          @if (startError) {
            <p [id]="startId + '-error'" class="field-error">{{ startError }}</p>
          }
        </div>
        <div class="field">
          <label [for]="endId"
            >Hasta <span class="visually-hidden">({{ name() }}, rango {{ r + 1 }})</span></label
          >
          <input
            [id]="endId"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="18:00"
            [formControl]="range.controls.end"
            [attr.aria-invalid]="endError ? 'true' : null"
            [attr.aria-describedby]="endError ? endId + '-error' : null"
          />
          @if (endError) {
            <p [id]="endId + '-error'" class="field-error">{{ endError }}</p>
          }
        </div>
        <button
          type="button"
          [attr.aria-label]="'Quitar rango ' + (r + 1) + ' de ' + name()"
          (click)="removeRange.emit(r)"
        >
          Quitar
        </button>
      </div>
    } @empty {
      <p class="empty">{{ emptyText() }}</p>
    }
    @let addError = errors()[prefix() + '-add'];
    <button
      type="button"
      [id]="prefix() + '-add'"
      [disabled]="ranges().length >= max"
      [attr.aria-label]="'Agregar rango a ' + name()"
      [attr.data-invalid]="addError ? 'true' : null"
      [attr.aria-describedby]="addError ? prefix() + '-add-error' : null"
      (click)="addRange.emit()"
    >
      Agregar rango
    </button>
    @if (addError) {
      <p [id]="prefix() + '-add-error'" class="field-error">{{ addError }}</p>
    }
  `,
})
export class RangesEditor {
  readonly ranges = input.required<FormArray<RangeGroup>>();
  readonly prefix = input.required<string>();
  readonly name = input.required<string>();
  readonly errors = input.required<Readonly<Record<string, string>>>();
  readonly emptyText = input.required<string>();

  readonly addRange = output();
  readonly removeRange = output<number>();

  protected readonly max = MAX_RANGES_PER_DAY;
}
