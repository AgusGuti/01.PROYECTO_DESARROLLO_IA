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
});
