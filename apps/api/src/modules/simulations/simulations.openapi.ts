// Documents the simulations route in the OpenAPI contract.
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { problemSchema } from '../../shared/http/problem.js';
import { simulationRequestSchema, simulationSchema } from './simulations.schemas.js';

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

export function registerSimulationsPaths(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/simulations',
    operationId: 'simulatePlanning',
    tags: ['Simulations'],
    summary: 'Simulate the planning of a project with a naive ordering',
    description:
      'Stateless: nothing is saved. Places every remaining unit of the project queue, in line ' +
      'order, on the printer that is free earliest. A print starts, and is collected, only when ' +
      'the intervention schedule allows. Work that would start more than 14 days after `startAt` ' +
      'is reported in `unplaced`. All times are Argentina wall-clock `YYYY-MM-DDTHH:mm`.',
    request: { body: { content: { 'application/json': { schema: simulationRequestSchema } } } },
    responses: {
      200: {
        description: 'The simulated timeline.',
        content: { 'application/json': { schema: simulationSchema } },
      },
      400: problem(
        'Invalid input. Issue path "projectId": the project does not exist or has no queue; ' +
          '"lines": more than 1000 units left; "printerIds": no selected printer is available.',
      ),
      503: problem(
        'The queue, project, part, printer or schedule data is temporarily unavailable.',
      ),
    },
  });
}
