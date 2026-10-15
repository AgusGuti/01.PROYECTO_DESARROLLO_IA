import { describe, expect, it } from 'vitest';
import {
  createPartSchema,
  listPartsQuerySchema,
  partIdParamsSchema,
  updatePartSchema,
} from './parts.schemas.js';

const valid = {
  name: 'Soporte de estante en L',
  material: 'PETG',
  dimensionsMm: { x: 60, y: 40, z: 25 },
  estimatedWeightGrams: 38,
  estimatedPrintSeconds: 5700,
  layerHeightUm: 200,
};

const gcodeSource = { kind: 'gcode', fileName: 'florero.gcode', slicer: 'cura' };

const accepts = (body: unknown): boolean => createPartSchema.safeParse(body).success;
const withField = (field: string, value: unknown): Record<string, unknown> => ({
  ...valid,
  [field]: value,
});
const withSource = (source: unknown): Record<string, unknown> => withField('source', source);
const withDimension = (axis: string, value: unknown): Record<string, unknown> =>
  withField('dimensionsMm', { ...valid.dimensionsMm, [axis]: value });
const updateAccepts = (body: unknown): boolean => updatePartSchema.safeParse(body).success;

describe.each([
  ['name', 100, false],
  ['description', 1000, true],
  ['suggestedPrinterName', 100, true],
])('create part: %s', (field, max, optional) => {
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
    ['a carriage return', 'a\rb'],
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
    const parsed = createPartSchema.parse(withField(field, '  Café  '));

    expect(Reflect.get(parsed, field)).toBe('Café');
  });

  it(optional ? 'may be left out' : 'is required', () => {
    expect(accepts({ ...valid, [field]: undefined })).toBe(optional);
  });
});

describe.each([
  ['estimatedWeightGrams', 1, 20_000],
  ['estimatedPrintSeconds', 1, 2_592_000],
  ['layerHeightUm', 10, 2000],
])('create part: %s', (field, min, max) => {
  it.each([min, max, Math.floor((min + max) / 2)])('accepts %s', (value) => {
    expect(accepts(withField(field, value))).toBe(true);
  });

  it.each([
    [`${String(min - 1)} (below the minimum)`, min - 1],
    [`${String(max + 1)} (above the maximum)`, max + 1],
    ['a negative number', -5],
    ['a decimal', min + 0.5],
    ['a numeric string', String(min)],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, value) => {
    expect(accepts(withField(field, value))).toBe(false);
  });

  it('is required', () => {
    expect(accepts({ ...valid, [field]: undefined })).toBe(false);
  });
});

describe('create part: dimensionsMm', () => {
  it.each(['x', 'y', 'z'])('accepts %s at 1 and at 1000', (axis) => {
    expect(accepts(withDimension(axis, 1))).toBe(true);
    expect(accepts(withDimension(axis, 1000))).toBe(true);
  });

  it.each(['x', 'y', 'z'])('rejects %s at 0, 1001, a decimal, a string and null', (axis) => {
    for (const value of [0, 1001, -1, 1.5, '10', null]) {
      expect(accepts(withDimension(axis, value))).toBe(false);
    }
  });

  it.each([
    ['a missing side', { x: 1, y: 1 }],
    ['an unknown key', { x: 1, y: 1, z: 1, w: 1 }],
    ['a string', '1x1x1'],
    ['null', null],
    ['an array', [1, 1, 1]],
  ])('rejects %s', (_label, value) => {
    expect(accepts(withField('dimensionsMm', value))).toBe(false);
  });
});

describe('create part: material', () => {
  it('accepts a catalog material and rejects others', () => {
    expect(accepts(withField('material', 'PA_CF'))).toBe(true);
    expect(accepts(withField('material', 'SILK'))).toBe(false);
    expect(accepts(withField('material', 'pla'))).toBe(false);
  });
});

describe('create part: source', () => {
  it('defaults to a manual source', () => {
    expect(createPartSchema.parse(valid).source).toEqual({ kind: 'manual' });
  });

  it('accepts manual and gcode sources', () => {
    expect(accepts(withSource({ kind: 'manual' }))).toBe(true);
    expect(accepts(withSource(gcodeSource))).toBe(true);
  });

  it.each([
    ['analyzedAt on a gcode source', { ...gcodeSource, analyzedAt: '2026-01-01T00:00:00.000Z' }],
    ['analyzedAt on a manual source', { kind: 'manual', analyzedAt: '2026-01-01T00:00:00.000Z' }],
    ['a manual source with a fileName', { kind: 'manual', fileName: 'a.gcode' }],
    ['a gcode source without a fileName', { kind: 'gcode', slicer: 'cura' }],
    ['a gcode source without a slicer', { kind: 'gcode', fileName: 'a.gcode' }],
    ['an unknown slicer', { ...gcodeSource, slicer: 'prusaslicer' }],
    ['an unknown kind', { kind: 'upload' }],
    ['no kind', { fileName: 'a.gcode', slicer: 'cura' }],
    ['a string', 'manual'],
    ['null', null],
    ['an empty fileName', { ...gcodeSource, fileName: '' }],
    ['a fileName with a newline', { ...gcodeSource, fileName: 'a\nb.gcode' }],
    ['a fileName with a NUL', { ...gcodeSource, fileName: 'a\u0000.gcode' }],
    ['a fileName of 256 characters', { ...gcodeSource, fileName: 'a'.repeat(256) }],
    ['an unknown key', { ...gcodeSource, path: '/etc/passwd' }],
  ])('rejects %s', (_label, source) => {
    expect(accepts(withSource(source))).toBe(false);
  });

  it('accepts a fileName of exactly 255 code points, even emoji', () => {
    expect(accepts(withSource({ ...gcodeSource, fileName: 'a'.repeat(255) }))).toBe(true);
    expect(accepts(withSource({ ...gcodeSource, fileName: '🧵'.repeat(255) }))).toBe(true);
    expect(accepts(withSource({ ...gcodeSource, fileName: '🧵'.repeat(256) }))).toBe(false);
  });

  it('keeps an HTML-looking fileName as plain text', () => {
    const parsed = createPartSchema.parse(
      withSource({ ...gcodeSource, fileName: '<img src=x onerror=alert(1)>.gcode' }),
    );

    expect(parsed.source).toMatchObject({ fileName: '<img src=x onerror=alert(1)>.gcode' });
  });
});

describe('create part: unknown keys', () => {
  it.each(['id', '_id', 'version', 'deletedAt', 'createdAt', 'updatedAt', 'analyzedAt', '$set'])(
    'rejects the key %s',
    (key) => {
      expect(accepts({ ...valid, [key]: 1 })).toBe(false);
    },
  );

  it('rejects an own __proto__ key', () => {
    const hostile: unknown = JSON.parse(`{"__proto__":{"admin":true},"name":"x"}`);

    expect(accepts(hostile)).toBe(false);
    expect(accepts(JSON.parse(JSON.stringify(valid).replace('{', '{"__proto__":{"a":1},')))).toBe(
      false,
    );
  });

  it('rejects an own __proto__ key inside dimensionsMm and source', () => {
    const dimensions: unknown = JSON.parse('{"x":1,"y":1,"z":1,"__proto__":{"a":1}}');
    const source: unknown = JSON.parse('{"kind":"manual","__proto__":{"a":1}}');

    expect(accepts(withField('dimensionsMm', dimensions))).toBe(false);
    expect(accepts(withSource(source))).toBe(false);
  });

  it.each([null, 'text', 42, []])('rejects the body %j', (body) => {
    expect(accepts(body)).toBe(false);
  });
});

describe('update part', () => {
  it('accepts a version with one field', () => {
    expect(updateAccepts({ version: 1, name: 'Otro' })).toBe(true);
  });

  it.each([
    ['a missing version', { name: 'Otro' }],
    ['version 0', { version: 0, name: 'Otro' }],
    ['a string version', { version: '1', name: 'Otro' }],
    ['a decimal version', { version: 1.5, name: 'Otro' }],
    ['only the version', { version: 1 }],
    ['id', { version: 1, id: 'x' }],
    ['deletedAt', { version: 1, deletedAt: '2026-01-01T00:00:00.000Z' }],
    ['an operator key', { version: 1, $set: { name: 'x' } }],
    ['a source with analyzedAt', { version: 1, source: { ...gcodeSource, analyzedAt: 'x' } }],
    ['a partial dimensionsMm', { version: 1, dimensionsMm: { x: 5 } }],
    ['dimensionsMm with an unknown key', { version: 1, dimensionsMm: { x: 5, y: 5, z: 5, w: 1 } }],
    ['a name that is too long', { version: 1, name: 'a'.repeat(101) }],
    ['a weight of 0', { version: 1, estimatedWeightGrams: 0 }],
    ['a null name', { version: 1, name: null }],
    ['a null weight', { version: 1, estimatedWeightGrams: null }],
  ])('rejects %s', (_label, body) => {
    expect(updateAccepts(body)).toBe(false);
  });

  it('accepts null to clear description and suggestedPrinterName', () => {
    const parsed = updatePartSchema.parse({
      version: 2,
      description: null,
      suggestedPrinterName: null,
    });

    expect(parsed).toEqual({ version: 2, description: null, suggestedPrinterName: null });
  });

  it('rejects an empty description and an empty printer name', () => {
    expect(updateAccepts({ version: 1, description: '' })).toBe(false);
    expect(updateAccepts({ version: 1, suggestedPrinterName: '  ' })).toBe(false);
  });

  it('accepts a source and keeps the other fields out when absent', () => {
    expect(updatePartSchema.parse({ version: 1, source: gcodeSource })).toEqual({
      version: 1,
      source: gcodeSource,
    });
    expect(updatePartSchema.parse({ version: 1, source: { kind: 'manual' } })).toEqual({
      version: 1,
      source: { kind: 'manual' },
    });
  });
});

describe('list parts query', () => {
  it('applies the defaults', () => {
    expect(listPartsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'name',
      order: 'asc',
    });
  });

  it.each([
    [
      { page: '1', pageSize: '1' },
      { page: 1, pageSize: 1 },
    ],
    [
      { page: '10000', pageSize: '100' },
      { page: 10_000, pageSize: 100 },
    ],
    [{ material: 'PLA_CF' }, { material: 'PLA_CF' }],
    [
      { sort: 'estimatedPrintSeconds', order: 'desc' },
      { sort: 'estimatedPrintSeconds', order: 'desc' },
    ],
  ])('accepts %j', (query, expected) => {
    expect(listPartsQuerySchema.parse(query)).toMatchObject(expected);
  });

  it.each([
    { page: '0' },
    { page: '10001' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1e2' },
    { page: ' 5' },
    { page: 'abc' },
    { pageSize: '0' },
    { pageSize: '101' },
    { material: 'SILK' },
    { material: { $ne: 'x' } },
    { sort: 'deletedAt' },
    { sort: '__proto__' },
    { sort: 'description' },
    { order: 'up' },
    { q: 'florero' },
    { unknown: '1' },
    { page: ['1', '2'] },
  ])('rejects %j', (query) => {
    expect(listPartsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('part id parameter', () => {
  it('accepts 24 hexadecimal characters', () => {
    expect(partIdParamsSchema.safeParse({ id: '66f0c0ffee0123456789abcd' }).success).toBe(true);
  });

  it.each(['abc', '0'.repeat(23), '0'.repeat(25), 'z'.repeat(24), '{"$ne":1}'])(
    'rejects "%s"',
    (id) => {
      expect(partIdParamsSchema.safeParse({ id }).success).toBe(false);
    },
  );
});
