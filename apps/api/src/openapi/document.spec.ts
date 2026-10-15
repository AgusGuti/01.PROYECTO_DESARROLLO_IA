import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './document.js';

// Written out on purpose: if the schema list changes, this test must be changed with it.
const ALLOWED_NOZZLE_DIAMETERS_MM = [0.2, 0.25, 0.4, 0.6, 0.8, 1];

describe('the generated OpenAPI document', () => {
  it('lists every allowed nozzle diameter, not only the first one', () => {
    const document = buildOpenApiDocument();
    const documented = JSON.stringify(document.components?.schemas?.['PrinterNozzle']);

    for (const diameter of ALLOWED_NOZZLE_DIAMETERS_MM) {
      expect(documented).toContain(`"enum":[${diameter}]`);
    }
  });

  it('documents the filament operations', () => {
    const paths = buildOpenApiDocument().paths ?? {};

    expect(Object.keys(paths['/api/v1/filaments'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(paths['/api/v1/filaments/{id}'] ?? {}).sort()).toEqual([
      'delete',
      'get',
      'patch',
    ]);
    expect(Object.keys(paths['/api/v1/filaments/{id}/consume'] ?? {})).toEqual(['post']);
  });

  it('documents the purchase date as a date string and the cost unit', () => {
    const schemas = buildOpenApiDocument().components?.schemas ?? {};

    expect(JSON.stringify(schemas['Filament'])).toContain('"format":"date"');
    expect(JSON.stringify(schemas['CreateFilamentRequest'])).toContain('"format":"date"');
    expect(JSON.stringify(schemas['Filament'])).toMatch(/centavos/i);
  });

  it('keeps one Material component shared by printers and filaments', () => {
    const document = buildOpenApiDocument();
    const schemas = document.components?.schemas ?? {};

    expect(Object.keys(schemas).filter((name) => name.startsWith('Material'))).toEqual([
      'Material',
    ]);
    expect(JSON.stringify(schemas['Filament'])).toContain('#/components/schemas/Material');
    expect(JSON.stringify(schemas['Printer'])).toContain('#/components/schemas/Material');
  });
});
