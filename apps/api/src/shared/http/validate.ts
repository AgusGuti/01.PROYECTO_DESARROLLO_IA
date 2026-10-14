// Runtime validation at the HTTP trust boundary (standard §5.2, §8.2).
// TypeScript types disappear at runtime; only a schema proves what a client actually sent.
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

/**
 * Parses untrusted input with a Zod schema.
 * @returns the validated, typed value. Unknown properties are dropped by `z.object`.
 * @throws AppError `validation_failed` listing each invalid field.
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new AppError('validation_failed', 'The request is not valid.', {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}
