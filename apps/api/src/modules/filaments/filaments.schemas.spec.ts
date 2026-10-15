import { describe, expect, it } from 'vitest';
import {
  consumeFilamentSchema,
  createFilamentSchema,
  filamentIdParamsSchema,
  listFilamentsQuerySchema,
  updateFilamentSchema,
} from './filaments.schemas.js';

const valid = {
  brand: 'Grilon3',
  material: 'PLA',
  colorName: 'Negro',
  initialGrams: 1000,
  purchaseCostMinor: 1_950_000,
  purchaseDate: '2026-02-01',
};

const accepts = (body: unknown): boolean => createFilamentSchema.safeParse(body).success;
const withField = (field: string, value: unknown): Record<string, unknown> => ({
  ...valid,
  [field]: value,
});

describe.each([
  ['brand', 60],
  ['colorName', 40],
])('create filament: %s', (field, max) => {
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
    ['a tab', 'a\tb'],
    ['a NUL character', 'a\u0000b'],
    ['a number', 42],
    ['null', null],
    ['an object', { $ne: '' }],
  ])('rejects %s', (_label, value) => {
    expect(accepts(withField(field, value))).toBe(false);
  });

  it('counts code points, so max emoji fit and one more does not', () => {
    expect(accepts(withField(field, '🧵'.repeat(max)))).toBe(true);
    expect(accepts(withField(field, '🧵'.repeat(max + 1)))).toBe(false);
  });

  it('trims and normalises to NFC', () => {
    const parsed = createFilamentSchema.parse(withField(field, '  Café  '));

    expect(Reflect.get(parsed, field)).toBe('Café');
  });
});

describe('create filament: material', () => {
  it('accepts a catalog material and rejects others', () => {
    expect(accepts(withField('material', 'PA_CF'))).toBe(true);
    expect(accepts(withField('material', 'SILK'))).toBe(false);
    expect(accepts(withField('material', 'pla'))).toBe(false);
  });
});

describe('create filament: grams', () => {
  it.each([1, 20_000, 1000])('accepts initialGrams %s', (value) => {
    expect(accepts(withField('initialGrams', value))).toBe(true);
  });

  it.each([0, -1, 20_001, 1.5, '100', null])('rejects initialGrams %j', (value) => {
    expect(accepts(withField('initialGrams', value))).toBe(false);
  });

  it.each([0, 1, 20_000])('accepts availableGrams %s', (value) => {
    expect(accepts(withField('availableGrams', value))).toBe(true);
  });

  it.each([-1, 20_001, 1.5, '5', null])('rejects availableGrams %j', (value) => {
    expect(accepts(withField('availableGrams', value))).toBe(false);
  });

  it('leaves availableGrams absent when it is not sent (the service defaults it)', () => {
    expect(createFilamentSchema.parse(valid)).not.toHaveProperty('availableGrams');
  });
});

describe('create filament: purchaseCostMinor', () => {
  it.each([0, 1, 1_000_000_000])('accepts %s', (value) => {
    expect(accepts(withField('purchaseCostMinor', value))).toBe(true);
  });

  it.each([-1, 1_000_000_001, 1.5, '100', null])('rejects %j', (value) => {
    expect(accepts(withField('purchaseCostMinor', value))).toBe(false);
  });
});

describe('create filament: purchaseDate', () => {
  it('turns a valid day into a Date at UTC midnight', () => {
    expect(createFilamentSchema.parse(valid).purchaseDate).toEqual(
      new Date('2026-02-01T00:00:00.000Z'),
    );
  });

  it.each(['2024-02-29', '1999-12-31'])('accepts the real date %s', (value) => {
    expect(accepts(withField('purchaseDate', value))).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2026-02-29',
    '2026-13-01',
    '2026-1-5',
    '26-01-05',
    '2026-02-01T00:00:00.000Z',
    '2026-02-01T00:00:00Z',
    '',
    20260201,
    null,
  ])('rejects %j', (value) => {
    expect(accepts(withField('purchaseDate', value))).toBe(false);
  });
});

describe('create filament: unknown keys and missing fields', () => {
  it.each(['id', '_id', 'version', 'deletedAt', 'createdAt', 'updatedAt', '$set', 'currency'])(
    'rejects the key %s',
    (key) => {
      expect(accepts(withField(key, 1))).toBe(false);
    },
  );

  it.each(Object.keys(valid))('rejects a body without %s', (key) => {
    const { [key]: _removed, ...rest } = valid as Record<string, unknown>;

    expect(accepts(rest)).toBe(false);
  });
});

describe('update filament', () => {
  const accepted = (body: unknown): boolean => updateFilamentSchema.safeParse(body).success;

  it('accepts a version with one field, and with all seven', () => {
    expect(accepted({ version: 1, colorName: 'Rojo' })).toBe(true);
    expect(accepted({ version: 3, ...valid, availableGrams: 5 })).toBe(true);
  });

  it.each([
    ['a missing version', { colorName: 'Rojo' }],
    ['version 0', { version: 0, colorName: 'Rojo' }],
    ['a string version', { version: '1', colorName: 'Rojo' }],
    ['version 1.5', { version: 1.5, colorName: 'Rojo' }],
    ['only the version', { version: 1 }],
    ['an empty body', {}],
    ['deletedAt', { version: 1, deletedAt: null }],
    ['an operator key', { version: 1, $set: { brand: 'x' } }],
    ['an invalid field', { version: 1, initialGrams: 0 }],
    ['an impossible date', { version: 1, purchaseDate: '2026-02-30' }],
  ])('rejects %s', (_label, body) => {
    expect(accepted(body)).toBe(false);
  });
});

describe('consume filament', () => {
  const accepted = (body: unknown): boolean => consumeFilamentSchema.safeParse(body).success;

  it.each([1, 20_000, 50])('accepts grams %s', (grams) => {
    expect(accepted({ grams })).toBe(true);
  });

  it.each([
    ['0', { grams: 0 }],
    ['-1', { grams: -1 }],
    ['1.5', { grams: 1.5 }],
    ['a string', { grams: '5' }],
    ['20001', { grams: 20_001 }],
    ['an extra key', { grams: 5, version: 1 }],
    ['an empty body', {}],
  ])('rejects %s', (_label, body) => {
    expect(accepted(body)).toBe(false);
  });
});

describe('list filaments query', () => {
  const parse = (query: Record<string, string>) => listFilamentsQuerySchema.safeParse(query);

  it('applies the defaults', () => {
    expect(parse({})).toMatchObject({
      success: true,
      data: { page: 1, pageSize: 20, sort: 'createdAt', order: 'desc' },
    });
  });

  it('reads inStock as a boolean', () => {
    expect(parse({ inStock: 'true' }).data).toMatchObject({ inStock: true });
    expect(parse({ inStock: 'false' }).data).toMatchObject({ inStock: false });
  });

  it.each([
    'unknown',
    'pageSize=0',
    'pageSize=101',
    'page=0',
    'page=10001',
    'sort=deletedAt',
    'sort=__proto__',
    'order=up',
    'inStock=1',
    'inStock=TRUE',
    'material=SILK',
  ])('rejects %s', (pair) => {
    const [key = '', value = '1'] = pair.split('=');

    expect(parse({ [key]: value }).success).toBe(false);
  });

  it.each([
    ['page', '10000'],
    ['pageSize', '100'],
    ['pageSize', '1'],
    ['material', 'PA_CF'],
    ['sort', 'purchaseDate'],
    ['sort', 'brand'],
    ['sort', 'availableGrams'],
  ])('accepts %s=%s', (key, value) => {
    expect(parse({ [key]: value }).success).toBe(true);
  });
});

describe('filament id', () => {
  it('accepts 24 hex characters only', () => {
    expect(filamentIdParamsSchema.safeParse({ id: 'a'.repeat(24) }).success).toBe(true);
    expect(filamentIdParamsSchema.safeParse({ id: 'z'.repeat(24) }).success).toBe(false);
    expect(filamentIdParamsSchema.safeParse({ id: 'a'.repeat(23) }).success).toBe(false);
  });
});
