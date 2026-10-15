import { describe, expect, it } from 'vitest';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamsSchema,
  updateProjectSchema,
} from './projects.schemas.js';

const A = 'a'.repeat(24);
const valid = { name: 'Soportes para el taller' };

const accepts = (body: unknown): boolean => createProjectSchema.safeParse(body).success;
const withField = (field: string, value: unknown): Record<string, unknown> => ({
  ...valid,
  [field]: value,
});
const updateAccepts = (body: unknown): boolean => updateProjectSchema.safeParse(body).success;
const listAccepts = (query: unknown): boolean => listProjectsQuerySchema.safeParse(query).success;
const line = (index: number) => ({ partId: index.toString(16).padStart(24, '0'), quantity: 1 });

describe.each([
  ['name', 100, false],
  ['description', 1000, true],
])('create project: %s', (field, max) => {
  it.each([
    ['one character', 'A'],
    [`exactly ${String(max)} characters`, 'a'.repeat(max)],
    [`${String(max)} characters after trimming`, `  ${'a'.repeat(max)}  `],
    ['accents and symbols', 'Ñandú #2'],
  ])('accepts %s', (_label, value) => {
    expect(accepts(withField(field, value))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '     '],
    [`${String(max + 1)} characters`, 'a'.repeat(max + 1)],
    ['a newline inside', 'a\nb'],
    ['a trailing newline', 'ab\n'],
    ['a NUL character', 'a\u0000b'],
    ['a number', 42],
    ['null', null],
    ['an object', { $ne: '' }],
  ])('rejects %s', (_label, value) => {
    expect(accepts(withField(field, value))).toBe(false);
  });

  it('trims and normalises to NFC', () => {
    const parsed = createProjectSchema.parse(withField(field, '  Café  '));

    expect(parsed).toHaveProperty(field, 'Café');
  });

  it('counts code points, so max emoji fit and one more does not', () => {
    expect(accepts(withField(field, '😀'.repeat(max)))).toBe(true);
    expect(accepts(withField(field, '😀'.repeat(max + 1)))).toBe(false);
  });
});

describe('create project: defaults and priority', () => {
  it('defaults the priority to normal and the lines to none', () => {
    expect(createProjectSchema.parse(valid)).toEqual({
      name: 'Soportes para el taller',
      priority: 'normal',
      items: [],
    });
  });

  it.each(['low', 'normal', 'high', 'urgent'])('accepts the priority %s', (priority) => {
    expect(accepts(withField('priority', priority))).toBe(true);
  });

  it.each(['', 'LOW', 'critical', 1, null])('rejects the priority %j', (priority) => {
    expect(accepts(withField('priority', priority))).toBe(false);
  });
});

describe('create project: deadline', () => {
  it.each(['2026-10-15', '2000-01-01', '2099-12-31', '2024-02-29', '2001-01-01'])(
    'accepts %s, past dates included',
    (deadline) => {
      expect(accepts(withField('deadline', deadline))).toBe(true);
    },
  );

  it('turns the day into a UTC midnight date', () => {
    const parsed = createProjectSchema.parse(withField('deadline', '2026-11-30'));

    expect(parsed.deadline).toEqual(new Date('2026-11-30T00:00:00.000Z'));
  });

  it.each([
    ['an impossible day', '2026-02-30'],
    ['not a leap year', '2025-02-29'],
    ['month 13', '2026-13-01'],
    ['year 1999', '1999-12-31'],
    ['year 2100', '2100-01-01'],
    ['a timestamp', '2026-10-15T00:00:00.000Z'],
    ['a slash format', '15/10/2026'],
    ['an empty string', ''],
    ['null (only an edit may clear it)', null],
    ['a number', 20261015],
  ])('rejects %s', (_label, deadline) => {
    expect(accepts(withField('deadline', deadline))).toBe(false);
  });
});

describe('create project: items', () => {
  it.each([
    ['quantity 1', 1],
    ['quantity 1000', 1000],
  ])('accepts %s', (_label, quantity) => {
    expect(accepts(withField('items', [{ partId: A, quantity }]))).toBe(true);
  });

  it.each([
    ['quantity 0', 0],
    ['quantity 1001', 1001],
    ['a fraction', 1.5],
    ['a negative number', -1],
    ['a string', '3'],
    ['null', null],
    ['NaN as text', 'NaN'],
  ])('rejects %s', (_label, quantity) => {
    expect(accepts(withField('items', [{ partId: A, quantity }]))).toBe(false);
  });

  it('accepts 100 lines and an empty list, and rejects 101', () => {
    expect(
      accepts(
        withField(
          'items',
          Array.from({ length: 100 }, (_v, i) => line(i)),
        ),
      ),
    ).toBe(true);
    expect(accepts(withField('items', []))).toBe(true);
    expect(
      accepts(
        withField(
          'items',
          Array.from({ length: 101 }, (_v, i) => line(i)),
        ),
      ),
    ).toBe(false);
  });

  it.each([
    ['a short id', 'abc'],
    ['a non-hexadecimal id', 'z'.repeat(24)],
    ['an object', { $ne: '' }],
    ['a number', 12],
  ])('rejects %s as partId', (_label, partId) => {
    expect(accepts(withField('items', [{ partId, quantity: 1 }]))).toBe(false);
  });

  it('rejects an unknown key inside a line and a missing field', () => {
    expect(accepts(withField('items', [{ partId: A, quantity: 1, price: 3 }]))).toBe(false);
    expect(accepts(withField('items', [{ partId: A }]))).toBe(false);
    expect(accepts(withField('items', [{ quantity: 1 }]))).toBe(false);
  });

  it('leaves the duplicate check to the domain: the schema alone accepts a repeated part', () => {
    expect(
      accepts(
        withField('items', [
          { partId: A, quantity: 1 },
          { partId: A, quantity: 2 },
        ]),
      ),
    ).toBe(true);
  });
});

describe('create project: unknown keys', () => {
  it.each(['id', '_id', 'version', 'deletedAt', 'createdAt', 'updatedAt', 'status', '$set'])(
    'rejects the key %s',
    (key) => {
      expect(accepts({ ...valid, [key]: 1 })).toBe(false);
    },
  );

  it('rejects a body without a name', () => {
    expect(accepts({})).toBe(false);
  });
});

describe('update project', () => {
  it('accepts the version plus one field', () => {
    expect(updateAccepts({ version: 1, name: 'Otro' })).toBe(true);
  });

  it('rejects a body with only the version', () => {
    expect(updateAccepts({ version: 1 })).toBe(false);
  });

  it.each([0, -1, 1.5, '1', null, undefined])('rejects the version %j', (version) => {
    expect(updateAccepts({ version, name: 'Otro' })).toBe(false);
  });

  it('lets null clear the description and the deadline', () => {
    expect(updateProjectSchema.parse({ version: 1, description: null, deadline: null })).toEqual({
      version: 1,
      description: null,
      deadline: null,
    });
  });

  it('does not accept null for the name, the priority or the items', () => {
    expect(updateAccepts({ version: 1, name: null })).toBe(false);
    expect(updateAccepts({ version: 1, priority: null })).toBe(false);
    expect(updateAccepts({ version: 1, items: null })).toBe(false);
  });

  it('accepts an empty list of lines: it empties the project', () => {
    expect(updateProjectSchema.parse({ version: 1, items: [] })).toEqual({ version: 1, items: [] });
  });

  it('applies the same date bounds', () => {
    expect(updateAccepts({ version: 1, deadline: '2026-02-30' })).toBe(false);
    expect(updateAccepts({ version: 1, deadline: '2100-01-01' })).toBe(false);
    expect(updateAccepts({ version: 1, deadline: '2000-01-01' })).toBe(true);
  });

  it.each(['id', 'deletedAt', 'status', 'createdAt'])('rejects the key %s', (key) => {
    expect(updateAccepts({ version: 1, name: 'x', [key]: 1 })).toBe(false);
  });
});

describe('project id parameter', () => {
  it('accepts 24 hexadecimal characters only', () => {
    expect(projectIdParamsSchema.safeParse({ id: A }).success).toBe(true);
    expect(projectIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
    expect(projectIdParamsSchema.safeParse({ id: `${A}0` }).success).toBe(false);
  });
});

describe('list projects query', () => {
  it('defaults to page 1, 20 per page, newest first', () => {
    expect(listProjectsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it.each([
    ['page 1', { page: '1' }],
    ['page 10000', { page: '10000' }],
    ['pageSize 1', { pageSize: '1' }],
    ['pageSize 100', { pageSize: '100' }],
    ['a priority', { priority: 'urgent' }],
    ['every sort', { sort: 'deadline' }],
    ['ascending order', { order: 'asc' }],
  ])('accepts %s', (_label, query) => {
    expect(listAccepts(query)).toBe(true);
  });

  it.each([
    ['page 0', { page: '0' }],
    ['page 10001', { page: '10001' }],
    ['pageSize 0', { pageSize: '0' }],
    ['pageSize 101', { pageSize: '101' }],
    ['a fraction', { page: '1.5' }],
    ['an exponent', { page: '1e2' }],
    ['a padded number', { page: ' 5' }],
    ['an unknown priority', { priority: 'critical' }],
    ['an unknown sort', { sort: 'version' }],
    ['a sort with an operator', { sort: '$where' }],
    ['an unknown order', { order: 'up' }],
    ['an unknown key', { status: 'open' }],
    ['a repeated parameter', { page: ['1', '2'] }],
  ])('rejects %s', (_label, query) => {
    expect(listAccepts(query)).toBe(false);
  });
});
