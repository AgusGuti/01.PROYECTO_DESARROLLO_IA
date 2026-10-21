import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Material, Part } from '@print3d/api-contracts';
import { firstValueFrom } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { GcodeAnalysisApi } from './gcode-analysis-api';
import {
  decide,
  type ImportDecision,
  isGcodePath,
  MAX_IMPORT_FILES,
  partName,
  relativeGcodePath,
  SKIP_LABELS,
  type SkipReason,
  toPart,
} from './part-import-plan';
import { formatDuration, isMaterial, MATERIAL_LABELS, MATERIAL_ORDER } from './part-labels';
import { PartsApi } from './parts-api';

/** The API analyses only this much of a file (ADR 0014). */
const HEAD_CHARACTERS = 65_536;
const LIST_PAGE_SIZE = 100;

const ERROR_TEXT = 'No se pudo procesar el archivo.';

interface Candidate {
  readonly path: string;
  readonly file: File;
}

type RowResult =
  | { readonly kind: 'decision'; readonly decision: ImportDecision }
  | { readonly kind: 'skipped'; readonly reason: SkipReason }
  | { readonly kind: 'error'; readonly message: string };

interface Row {
  readonly path: string;
  readonly name: string;
  readonly grams: number | null;
  readonly seconds: number | null;
  readonly result: RowResult;
}

/** Every state the screen can be in. */
type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'analysing'; readonly done: number; readonly total: number }
  | { readonly kind: 'preview'; readonly rows: readonly Row[] }
  | { readonly kind: 'importing'; readonly done: number; readonly total: number }
  | {
      readonly kind: 'done';
      readonly created: number;
      readonly updated: number;
      readonly failed: number;
    }
  | { readonly kind: 'failed'; readonly message: string };

const ACTION_TEXT: Readonly<Record<'create' | 'update' | 'unchanged', string>> = {
  create: 'Crear',
  update: 'Actualizar',
  unchanged: 'Sin cambios',
};

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : ERROR_TEXT;
}

@Component({
  selector: 'app-parts-import-page',
  imports: [RouterLink],
  templateUrl: './parts-import-page.html',
  styleUrl: './parts-import-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartsImportPage {
  private readonly parts = inject(PartsApi);
  private readonly analysis = inject(GcodeAnalysisApi);
  private alive = true;

  protected readonly materialOptions = MATERIAL_ORDER.map((value) => ({
    value,
    label: MATERIAL_LABELS[value],
  }));
  protected readonly maxFiles = MAX_IMPORT_FILES;

  protected readonly material = signal<Material>('PLA');
  protected readonly candidates = signal<readonly Candidate[]>([]);
  /** Set when the chosen folder cannot be used (nothing to import, or too many files). */
  protected readonly pickProblem = signal<string | null>(null);
  protected readonly state = signal<ViewState>({ kind: 'idle' });

  protected readonly busy = computed(() => {
    const kind = this.state().kind;
    return kind === 'analysing' || kind === 'importing';
  });
  protected readonly canAnalyse = computed(() => this.candidates().length > 0 && !this.busy());

  /** Rows that would write something; the import button needs at least one. */
  protected readonly pending = computed(() => {
    const state = this.state();
    return state.kind === 'preview'
      ? state.rows.filter(
          (row) => row.result.kind === 'decision' && row.result.decision.action !== 'unchanged',
        ).length
      : 0;
  });

  protected readonly counts = computed(() => {
    const state = this.state();
    const rows = state.kind === 'preview' ? state.rows : [];
    const count = (label: string) => rows.filter((row) => this.actionText(row) === label).length;
    return {
      create: count(ACTION_TEXT.create),
      update: count(ACTION_TEXT.update),
      unchanged: count(ACTION_TEXT.unchanged),
      skipped: rows.filter((row) => row.result.kind === 'skipped').length,
      error: rows.filter((row) => row.result.kind === 'error').length,
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.alive = false;
    });
  }

  protected pickFolder(input: HTMLInputElement): void {
    const found: Candidate[] = [];
    for (const file of Array.from(input.files ?? [])) {
      // The first segment of webkitRelativePath is the folder itself.
      const path = relativeGcodePath(file.webkitRelativePath);
      if (path !== '' && isGcodePath(path)) found.push({ path, file });
    }
    found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    this.state.set({ kind: 'idle' });
    if (found.length === 0) {
      this.candidates.set([]);
      this.pickProblem.set('La carpeta no tiene archivos .gcode.');
    } else if (found.length > MAX_IMPORT_FILES) {
      this.candidates.set([]);
      this.pickProblem.set(
        `La carpeta tiene ${String(found.length)} archivos .gcode y el máximo es ${String(MAX_IMPORT_FILES)}. Elegí una subcarpeta.`,
      );
    } else {
      this.candidates.set(found);
      this.pickProblem.set(null);
    }
  }

  protected changeMaterial(value: string): void {
    if (isMaterial(value)) {
      this.material.set(value);
      // A preview was made for another material.
      if (this.state().kind === 'preview') this.state.set({ kind: 'idle' });
    }
  }

  protected actionText(row: Row): string {
    switch (row.result.kind) {
      case 'decision':
        return ACTION_TEXT[row.result.decision.action];
      case 'skipped':
        return 'Omitido';
      case 'error':
        return 'Error';
    }
  }

  protected reasonText(row: Row): string {
    switch (row.result.kind) {
      case 'skipped':
        return SKIP_LABELS[row.result.reason];
      case 'error':
        return row.result.message;
      case 'decision':
        return '';
    }
  }

  protected duration(seconds: number): string {
    return formatDuration(seconds);
  }

  /** Reads the already imported parts, then analyses every file one at a time. */
  protected async analyse(): Promise<void> {
    if (!this.canAnalyse()) return;
    const files = this.candidates();
    const material = this.material();
    this.state.set({ kind: 'analysing', done: 0, total: files.length });
    let existing: ReadonlyMap<string, Part>;
    try {
      existing = await this.importedParts();
    } catch (error) {
      if (this.alive) this.state.set({ kind: 'failed', message: errorText(error) });
      return;
    }

    const rows: Row[] = [];
    for (const [index, candidate] of files.entries()) {
      rows.push(await this.analyseFile(candidate, material, existing));
      if (!this.alive) return;
      this.state.set({ kind: 'analysing', done: index + 1, total: files.length });
    }
    this.state.set({ kind: 'preview', rows });
  }

  protected async runImport(): Promise<void> {
    const state = this.state();
    if (state.kind !== 'preview' || this.pending() === 0) return;
    const writes = state.rows.flatMap((row) =>
      row.result.kind === 'decision' && row.result.decision.action !== 'unchanged'
        ? [row.result.decision]
        : [],
    );
    let created = 0;
    let updated = 0;
    let failed = 0;
    this.state.set({ kind: 'importing', done: 0, total: writes.length });
    for (const [index, decision] of writes.entries()) {
      try {
        // Never retried: a POST that is repeated makes a second part.
        if (decision.action === 'create') {
          await firstValueFrom(this.parts.create(decision.body));
          created += 1;
        } else {
          await firstValueFrom(this.parts.update(decision.id, decision.body));
          updated += 1;
        }
      } catch {
        failed += 1;
      }
      if (!this.alive) return;
      this.state.set({ kind: 'importing', done: index + 1, total: writes.length });
    }
    this.state.set({ kind: 'done', created, updated, failed });
  }

  protected reset(): void {
    this.state.set({ kind: 'idle' });
  }

  private async analyseFile(
    candidate: Candidate,
    material: Material,
    existing: ReadonlyMap<string, Part>,
  ): Promise<Row> {
    const name = partName(candidate.path);
    try {
      const head = await candidate.file.slice(0, HEAD_CHARACTERS).text();
      const analysis = await firstValueFrom(this.analysis.analyse(head, material));
      const built = toPart(candidate.path, analysis, material);
      if ('skip' in built) {
        return {
          path: candidate.path,
          name,
          grams: null,
          seconds: null,
          result: { kind: 'skipped', reason: built.skip },
        };
      }
      return {
        path: candidate.path,
        name,
        grams: built.part.estimatedWeightGrams,
        seconds: built.part.estimatedPrintSeconds,
        result: { kind: 'decision', decision: decide(built.part, existing.get(candidate.path)) },
      };
    } catch (error) {
      return {
        path: candidate.path,
        name,
        grams: null,
        seconds: null,
        result: { kind: 'error', message: errorText(error) },
      };
    }
  }

  /** Parts that came from a G-code file, by the relative path kept in `source.fileName`. */
  private async importedParts(): Promise<ReadonlyMap<string, Part>> {
    const byFile = new Map<string, Part>();
    for (let page = 1; ; page++) {
      const list = await firstValueFrom(this.parts.list({ page, pageSize: LIST_PAGE_SIZE }));
      for (const part of list.items) {
        if (part.source.kind === 'gcode') byFile.set(part.source.fileName, part);
      }
      if (page * LIST_PAGE_SIZE >= list.total) return byFile;
    }
  }
}
