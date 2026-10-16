import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { parseInput } from '../../shared/http/validate.js';
import {
  createQueueSchema,
  deleteQueueQuerySchema,
  queueParamsSchema,
  updateQueueSchema,
} from './queues.schemas.js';
import { PART_A, PART_B, PRINTER_1, PRINTER_2, PROJECT_ID } from './testing/fakes.js';

const valid = { projectId: PROJECT_ID, goal: 'fastest', mode: 'single', printerIds: [PRINTER_1] };

function paths(schema: Parameters<typeof parseInput>[0], input: unknown): string[] {
  try {
    parseInput(schema, input);
  } catch (error) {
    if (error instanceof AppError) return error.issues.map((issue) => issue.path);
    throw error;
  }
  return [];
}

describe('createQueueSchema', () => {
  it('accepts the minimal body and lower-cases ids', () => {
    const parsed = parseInput(createQueueSchema, {
      ...valid,
      projectId: PROJECT_ID.toUpperCase().replaceAll('1', 'A'),
    });

    expect(parsed.projectId).toBe('a'.repeat(24));
    expect(parsed.lines).toBeUndefined();
  });

  it('defaults completed to 0', () => {
    const parsed = parseInput(createQueueSchema, {
      ...valid,
      lines: [{ partId: PART_A, quantity: 2 }],
    });

    expect(parsed.lines).toEqual([{ partId: PART_A, quantity: 2, completed: 0 }]);
  });

  it.each([
    ['an unknown key', { ...valid, version: 1 }, ['']],
    ['a malformed projectId', { ...valid, projectId: 'x' }, ['projectId']],
    ['an unknown goal', { ...valid, goal: 'cheapest' }, ['goal']],
    ['an unknown mode', { ...valid, mode: 'dual' }, ['mode']],
    ['no printers', { ...valid, printerIds: [] }, ['printerIds']],
    ['11 printers', { ...valid, printerIds: Array(11).fill(PRINTER_1) }, ['printerIds']],
    [
      'two printers in single mode',
      { ...valid, printerIds: [PRINTER_1, PRINTER_2] },
      ['printerIds'],
    ],
    ['one printer in multi mode', { ...valid, mode: 'multi' }, ['printerIds']],
    [
      'a repeated printer',
      { ...valid, mode: 'multi', printerIds: [PRINTER_1, PRINTER_1] },
      ['printerIds.1'],
    ],
    ['quantity 0', { ...valid, lines: [{ partId: PART_A, quantity: 0 }] }, ['lines.0.quantity']],
    [
      'quantity 1001',
      { ...valid, lines: [{ partId: PART_A, quantity: 1001 }] },
      ['lines.0.quantity'],
    ],
    [
      'completed above quantity',
      { ...valid, lines: [{ partId: PART_A, quantity: 2, completed: 3 }] },
      ['lines.0.completed'],
    ],
    [
      'a repeated part',
      {
        ...valid,
        lines: [
          { partId: PART_A, quantity: 1 },
          { partId: PART_B, quantity: 1 },
          { partId: PART_A, quantity: 1 },
        ],
      },
      ['lines.2.partId'],
    ],
    [
      '101 lines',
      {
        ...valid,
        lines: Array.from({ length: 101 }, (_, i) => ({
          partId: i.toString(16).padStart(24, '0'),
          quantity: 1,
        })),
      },
      ['lines'],
    ],
    [
      'an unknown key inside a line',
      { ...valid, lines: [{ partId: PART_A, quantity: 1, price: 1 }] },
      ['lines.0'],
    ],
  ])('rejects %s', (_label, body, expected) => {
    expect(paths(createQueueSchema, body)).toEqual(expected);
  });

  it('accepts 100 lines and a multi selection of 10 printers', () => {
    const parsed = parseInput(createQueueSchema, {
      ...valid,
      mode: 'multi',
      printerIds: Array.from({ length: 10 }, (_, i) => i.toString(16).padStart(24, '0')),
      lines: Array.from({ length: 100 }, (_, i) => ({
        partId: i.toString(16).padStart(24, '0'),
        quantity: 1000,
        completed: 1000,
      })),
    });

    expect(parsed.lines).toHaveLength(100);
  });
});

describe('updateQueueSchema', () => {
  it('accepts a version with one field', () => {
    expect(parseInput(updateQueueSchema, { version: 1, goal: 'deadline' })).toEqual({
      version: 1,
      goal: 'deadline',
    });
  });

  it('requires completed in every replaced line', () => {
    expect(
      paths(updateQueueSchema, { version: 1, lines: [{ partId: PART_A, quantity: 2 }] }),
    ).toEqual(['lines.0.completed']);
  });

  it.each([
    ['no version', { goal: 'deadline' }],
    ['version 0', { version: 0, goal: 'deadline' }],
    ['only a version', { version: 1 }],
    ['projectId in the body', { version: 1, projectId: PROJECT_ID }],
    ['a repeated printer', { version: 1, printerIds: [PRINTER_1, PRINTER_1] }],
  ])('rejects %s', (_label, body) => {
    expect(paths(updateQueueSchema, body)).not.toEqual([]);
  });

  it('checks the count rule when mode and printerIds come together', () => {
    expect(
      paths(updateQueueSchema, { version: 1, mode: 'multi', printerIds: [PRINTER_1] }),
    ).toEqual(['printerIds']);
  });
});

describe('queueParamsSchema and deleteQueueQuerySchema', () => {
  it('rejects a malformed id and an operator-looking id', () => {
    expect(paths(queueParamsSchema, { projectId: '{"$ne":null}' })).toEqual(['projectId']);
  });

  it.each([{}, { version: '0' }, { version: '1e2' }, { version: '1', extra: 'x' }])(
    'rejects the delete query %j',
    (query) => {
      expect(paths(deleteQueueQuerySchema, query)).not.toEqual([]);
    },
  );

  it('parses the version as a number', () => {
    expect(parseInput(deleteQueueQuerySchema, { version: '3' })).toEqual({ version: 3 });
  });
});
