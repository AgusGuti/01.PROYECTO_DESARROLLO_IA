// Assembles the OpenAPI document from the Zod schemas each module registers.
// `npm run contract` writes it to packages/api-contracts/openapi.yaml; never edit that file.
import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { registerHealthPaths } from '../modules/health/index.js';
import { registerFilamentsPaths } from '../modules/filaments/index.js';
import { registerGcodePaths } from '../modules/gcode/index.js';
import { registerPartsPaths } from '../modules/parts/index.js';
import { registerPrintersPaths } from '../modules/printers/index.js';
import { problemSchema } from '../shared/http/problem.js';

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const registry = new OpenAPIRegistry();

  registry.register('Problem', problemSchema);
  registerHealthPaths(registry);
  registerPrintersPaths(registry);
  registerFilamentsPaths(registry);
  registerPartsPaths(registry);
  registerGcodePaths(registry);
  // Feature modules register their paths here as they are added.

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Print3D Planner API',
      version: '0.1.0',
      description:
        'REST API for 3D print management, costing and scheduling. Dates are RFC 3339 in UTC. ' +
        'Errors use RFC 9457 problem details (application/problem+json).',
    },
    servers: [{ url: 'http://127.0.0.1:3000', description: 'Local development' }],
  });
}
