// Error response format: RFC 9457 "Problem Details" (standard §6.3).
import { ERROR_CODES, type AppError } from '../errors/app-error.js';
import { z } from './zod.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const problemSchema = z
  .object({
    type: z.string().openapi({ example: 'urn:print3d:problem:not_found' }),
    title: z.string().openapi({ example: 'Not found' }),
    status: z.number().int().openapi({ example: 404 }),
    detail: z.string().openapi({ example: 'The requested resource does not exist.' }),
    code: z.enum(ERROR_CODES),
    requestId: z.string().openapi({ description: 'Quote this id when reporting a problem.' }),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .openapi({ description: 'Per-field validation problems.' }),
  })
  .openapi('Problem');

export type Problem = z.infer<typeof problemSchema>;

export function toProblem(error: AppError, requestId: string): Problem {
  return {
    type: `urn:print3d:problem:${error.code}`,
    title: error.title,
    status: error.status,
    detail: error.message,
    code: error.code,
    requestId,
    ...(error.issues.length > 0 ? { issues: [...error.issues] } : {}),
  };
}
