// Documents the G-code analysis route in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import { analyzeGcodeSchema, gcodeAnalysisSchema } from './gcode.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerGcodePaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/gcode-analyses',
    operationId: 'analyzeGcode',
    tags: ['G-code'],
    summary: 'Read the estimates from the head of a Cura G-code file',
    description:
      'Stateless: nothing is stored and the text is never logged or returned. It answers 200 ' +
      'because it creates no resource. Only Cura (Marlin or RepRap flavour) is recognised.',
    request: { body: { content: { 'application/json': { schema: analyzeGcodeSchema } } } },
    responses: {
      200: {
        description: 'The numbers found, with warning codes about how reliable they are.',
        content: { 'application/json': { schema: gcodeAnalysisSchema } },
      },
      400: problem(
        'Invalid input, or the head is not a supported Cura header (issue path "head").',
      ),
      413: problem('The request body is over the size limit.'),
    },
  });
}
