import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  CreatePartRequest,
  GcodeAnalysis,
  Part,
  PartList,
  UpdatePartRequest,
} from '@print3d/api-contracts';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiError } from '../../core/api/api-error';
import { GcodeAnalysisApi } from './gcode-analysis-api';
import { PartsApi } from './parts-api';
import { PartsImportPage } from './parts-import-page';

const ANALYSIS: GcodeAnalysis = {
  slicer: 'cura',
  estimatedPrintSeconds: 3600,
  filamentMm: 1000,
  filamentGrams: 12,
  layerHeightUm: 200,
  dimensionsMm: { x: 10, y: 20, z: 30 },
  targetMachineName: null,
  warnings: [],
};

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'p1',
    name: 'Nombre propio',
    description: null,
    material: 'PLA',
    dimensionsMm: { x: 10, y: 20, z: 30 },
    estimatedWeightGrams: 12,
    estimatedPrintSeconds: 3600,
    layerHeightUm: 200,
    suggestedPrinterName: null,
    source: {
      kind: 'gcode',
      fileName: 'Minis/a_b.gcode',
      slicer: 'cura',
      analyzedAt: '2026-01-01T00:00:00.000Z',
    },
    version: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function gcodeFile(relativePath: string, content = '; gcode'): File {
  const file = new File([content], relativePath.split('/').pop() ?? '');
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

interface Setup {
  readonly existing?: Part[];
  readonly analyse?: () => ReturnType<GcodeAnalysisApi['analyse']>;
}

async function render(setup: Setup = {}) {
  const items = setup.existing ?? [];
  const api = {
    list: vi.fn(() => of<PartList>({ items, page: 1, pageSize: 100, total: items.length })),
    create: vi.fn((body: CreatePartRequest) => of(makePart({ id: 'new', name: body.name }))),
    update: vi.fn((_id: string, _body: UpdatePartRequest) => of(makePart())),
  };
  const analysis = { analyse: vi.fn(setup.analyse ?? (() => of(ANALYSIS))) };
  TestBed.configureTestingModule({
    imports: [PartsImportPage],
    providers: [
      provideRouter([]),
      { provide: PartsApi, useValue: api },
      { provide: GcodeAnalysisApi, useValue: analysis },
    ],
  });
  const fixture = TestBed.createComponent(PartsImportPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;

  const settle = async () => {
    // The screen awaits real promises (file reads), so give them time to finish.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.textContent).not.toMatch(/Analizando|Importando/);
    });
  };
  const button = (text: string) =>
    Array.from(element.querySelectorAll('button')).find((b) => b.textContent.includes(text));

  const pick = async (files: File[]) => {
    const input = element.querySelector<HTMLInputElement>('#import-folder');
    if (!input) throw new Error('no folder input');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const analyse = async () => {
    button('Analizar')?.click();
    await settle();
  };
  return { api, analysis, element, fixture, button, pick, analyse, settle };
}

describe('PartsImportPage', () => {
  it('has one h1 and a labelled folder input and material select', async () => {
    const page = await render();

    expect(page.element.querySelectorAll('h1')).toHaveLength(1);
    expect(page.element.querySelector('label[for="import-folder"]')).not.toBeNull();
    expect(page.element.querySelector('label[for="import-material"]')).not.toBeNull();
    expect(page.button('Analizar')?.disabled).toBe(true);
  });

  it('explains when the folder has no .gcode files', async () => {
    const page = await render();

    await page.pick([gcodeFile('Carpeta/notas.txt')]);

    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain(
      'no tiene archivos',
    );
    expect(page.button('Analizar')?.disabled).toBe(true);
  });

  it('refuses a folder with more than 1000 files', async () => {
    const page = await render();
    const files = Array.from({ length: 1001 }, (_, i) => gcodeFile(`Carpeta/f${String(i)}.gcode`));

    await page.pick(files);

    expect(page.element.querySelector('[role="alert"]')?.textContent).toContain('1000');
    expect(page.button('Analizar')?.disabled).toBe(true);
  });

  it('previews a create without writing anything, using the path inside the folder', async () => {
    const page = await render();

    await page.pick([gcodeFile('00.GCODES/Minis/a_b.gcode')]);
    await page.analyse();

    const row = page.element.querySelector('tbody tr');
    expect(row?.textContent).toContain('Minis/a_b.gcode');
    expect(row?.textContent).toContain('a b');
    expect(row?.textContent).toContain('Crear');
    expect(page.api.create).not.toHaveBeenCalled();
    expect(page.analysis.analyse).toHaveBeenCalledWith('; gcode', 'PLA');
  });

  it('creates the parts after the user confirms', async () => {
    const page = await render();
    await page.pick([gcodeFile('00.GCODES/Minis/a_b.gcode')]);
    await page.analyse();

    page.button('Importar 1 pieza')?.click();
    await page.settle();

    expect(page.api.create).toHaveBeenCalledTimes(1);
    expect(page.api.create.mock.calls[0]?.[0].source).toEqual({
      kind: 'gcode',
      fileName: 'Minis/a_b.gcode',
      slicer: 'cura',
    });
    expect(page.element.textContent).toContain('1 creadas, 0 actualizadas');
  });

  it('updates an imported part without sending its name', async () => {
    const page = await render({ existing: [makePart()] });
    page.api.update.mockClear();
    const heavier = { ...ANALYSIS, filamentGrams: 99 };
    page.analysis.analyse.mockReturnValue(of(heavier));
    await page.pick([gcodeFile('00.GCODES/Minis/a_b.gcode')]);
    await page.analyse();

    expect(page.element.querySelector('tbody tr')?.textContent).toContain('Actualizar');
    page.button('Importar 1 pieza')?.click();
    await page.settle();

    const [id, body] = page.api.update.mock.calls[0] ?? [];
    expect(id).toBe('p1');
    expect(body?.version).toBe(2);
    expect(body).not.toHaveProperty('name');
  });

  it('leaves identical parts alone and disables the import', async () => {
    const page = await render({ existing: [makePart()] });
    await page.pick([gcodeFile('00.GCODES/Minis/a_b.gcode')]);
    await page.analyse();

    expect(page.element.querySelector('tbody tr')?.textContent).toContain('Sin cambios');
    expect(page.button('Importar')?.disabled).toBe(true);
  });

  it('shows a skipped file with its reason and keeps going after an error', async () => {
    const answers = [
      of({ ...ANALYSIS, dimensionsMm: null }),
      throwError(() => new ApiError(500, 'internal', 'Falló el servidor.')),
      of(ANALYSIS),
    ];
    const page = await render({ analyse: () => answers.shift() ?? of(ANALYSIS) });

    await page.pick([
      gcodeFile('Carpeta/a.gcode'),
      gcodeFile('Carpeta/b.gcode'),
      gcodeFile('Carpeta/c.gcode'),
    ]);
    await page.analyse();

    const rows = Array.from(page.element.querySelectorAll('tbody tr')).map((r) => r.textContent);
    expect(rows[0]).toContain('Omitido');
    expect(rows[0]).toContain('dimensiones');
    expect(rows[1]).toContain('Error');
    expect(rows[1]).toContain('Falló el servidor.');
    expect(rows[2]).toContain('Crear');
  });

  it('shows an error when the existing parts cannot be read', async () => {
    const page = await render();
    page.api.list.mockReturnValue(throwError(() => new ApiError(500, 'internal', 'Sin conexión.')));
    await page.pick([gcodeFile('Carpeta/a.gcode')]);

    await page.analyse();
    await vi.waitFor(() => {
      page.fixture.detectChanges();
      expect(page.element.querySelector('[role="alert"]')?.textContent).toContain('Sin conexión.');
    });
    expect(page.api.create).not.toHaveBeenCalled();
  });

  it('counts a part that failed to save and does not stop the rest', async () => {
    const page = await render();
    page.api.create.mockReturnValueOnce(
      throwError(() => new ApiError(400, 'validation', 'Datos inválidos.')),
    );
    await page.pick([gcodeFile('Carpeta/a.gcode'), gcodeFile('Carpeta/b.gcode')]);
    await page.analyse();

    page.button('Importar 2 piezas')?.click();
    await page.settle();

    expect(page.api.create).toHaveBeenCalledTimes(2);
    expect(page.element.textContent).toContain('1 creadas');
    expect(page.element.textContent).toContain('1 no se pudieron guardar');
  });
});
