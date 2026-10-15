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

  it('requires the version to edit a filament and documents its error answers', () => {
    const document = buildOpenApiDocument();
    const update = JSON.stringify(document.components?.schemas?.['UpdateFilamentRequest']);
    const patch = document.paths?.['/api/v1/filaments/{id}']?.patch;

    expect(update).toMatch(/"required":\[[^\]]*"version"/);
    expect(Object.keys(patch?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '404', '409']),
    );
    expect(
      Object.keys(document.paths?.['/api/v1/filaments/{id}/consume']?.post?.responses ?? {}),
    ).toEqual(expect.arrayContaining(['200', '400', '404', '409']));
  });

  it('documents the part operations', () => {
    const paths = buildOpenApiDocument().paths ?? {};

    expect(Object.keys(paths['/api/v1/parts'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(paths['/api/v1/parts/{id}'] ?? {}).sort()).toEqual([
      'delete',
      'get',
      'patch',
    ]);
    expect(Object.keys(paths['/api/v1/gcode-analyses'] ?? {})).toEqual(['post']);
  });

  it('documents both part source variants, as input and as output, with a discriminator', () => {
    const schemas = buildOpenApiDocument().components?.schemas ?? {};
    const input = JSON.stringify(schemas['PartSourceInput']);
    const output = JSON.stringify(schemas['PartSource']);

    for (const union of [input, output]) {
      expect(union).toContain('"discriminator":{"propertyName":"kind"');
      expect(union).toContain('#/components/schemas/ManualPartSource');
    }
    expect(input).toContain('#/components/schemas/GcodePartSourceInput');
    expect(output).toContain('#/components/schemas/GcodePartSource"');
    expect(JSON.stringify(schemas['ManualPartSource'])).toContain('"enum":["manual"]');
    expect(JSON.stringify(schemas['GcodePartSourceInput'])).toContain('"enum":["gcode"]');
    expect(JSON.stringify(schemas['GcodePartSourceInput'])).not.toContain('analyzedAt');
    expect(JSON.stringify(schemas['GcodePartSource'])).toMatch(/"required":\[[^\]]*"analyzedAt"/);
  });

  it('documents every G-code warning code as one named enum', () => {
    const schemas = buildOpenApiDocument().components?.schemas ?? {};

    expect(schemas['GcodeWarningCode']).toEqual({
      type: 'string',
      enum: [
        'GRAMS_FROM_DENSITY_TABLE',
        'MATERIAL_NOT_SELECTED',
        'WEIGHT_OUT_OF_RANGE',
        'LAYER_HEIGHT_UNAVAILABLE',
        'DIMENSIONS_UNAVAILABLE',
        'DIMENSIONS_INCLUDE_SKIRT_OR_BRIM',
        'MULTIPLE_EXTRUDERS_SUMMED',
      ],
    });
    expect(JSON.stringify(schemas['GcodeAnalysis'])).toContain(
      '#/components/schemas/GcodeWarningCode',
    );
  });

  it('documents null as an allowed value to clear the optional part texts', () => {
    const update = JSON.stringify(
      buildOpenApiDocument().components?.schemas?.['UpdatePartRequest'],
    );

    expect(update).toMatch(/"description":\{"type":\["string","null"\]/);
    expect(update).toMatch(/"suggestedPrinterName":\{"type":\["string","null"\]/);
  });

  it('keeps one Material component shared by printers, filaments and parts', () => {
    const document = buildOpenApiDocument();
    const schemas = document.components?.schemas ?? {};

    expect(Object.keys(schemas).filter((name) => name.startsWith('Material'))).toEqual([
      'Material',
    ]);
    expect(JSON.stringify(schemas['Filament'])).toContain('#/components/schemas/Material');
    expect(JSON.stringify(schemas['Printer'])).toContain('#/components/schemas/Material');
    expect(JSON.stringify(schemas['Part'])).toContain('#/components/schemas/Material');
    expect(JSON.stringify(schemas['AnalyzeGcodeRequest'])).toContain(
      '#/components/schemas/Material',
    );
  });

  it('documents the project operations and the part usage endpoint', () => {
    const paths = buildOpenApiDocument().paths ?? {};

    expect(Object.keys(paths['/api/v1/projects'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(Object.keys(paths['/api/v1/projects/{id}'] ?? {}).sort()).toEqual([
      'delete',
      'get',
      'patch',
    ]);
    expect(Object.keys(paths['/api/v1/parts/{id}/usage'] ?? {})).toEqual(['get']);
  });

  it('documents the 409 of a used part, the confirmation flag and a nullable part on a line', () => {
    const document = buildOpenApiDocument();
    const remove = JSON.stringify(document.paths?.['/api/v1/parts/{id}']?.delete);

    expect(remove).toContain('removeFromProjects');
    expect(remove).toContain('"409"');
    expect(JSON.stringify(document.components?.schemas?.['ProjectItem'])).toContain('"null"');
    expect(JSON.stringify(document.components?.schemas?.['Project'])).toContain('"format":"date"');
  });
});
