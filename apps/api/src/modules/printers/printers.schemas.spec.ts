import { describe, expect, it } from 'vitest';
import {
  createPrinterSchema,
  listPrintersQuerySchema,
  printerIdParamsSchema,
  updatePrinterSchema,
} from './printers.schemas.js';

const valid = {
  name: 'Ender 3',
  buildVolume: { x: 220, y: 220, z: 250 },
  nozzle: { diameterMm: 0.4, material: 'brass' },
  compatibleMaterials: ['PLA', 'PETG'],
};

const accepts = (body: unknown): boolean => createPrinterSchema.safeParse(body).success;
const withField = (field: string, value: unknown): Record<string, unknown> => ({
  ...valid,
  [field]: value,
});

describe('create printer: name', () => {
  it.each([
    ['one character', 'A'],
    ['exactly 100 characters', 'a'.repeat(100)],
    ['100 characters after trimming', `  ${'a'.repeat(100)}  `],
    ['accents and symbols', 'Impresora Ñandú #2 (taller)'],
  ])('accepts %s', (_label, name) => {
    expect(accepts(withField('name', name))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '     '],
    ['101 characters', 'a'.repeat(101)],
    ['a newline inside', 'Ender\n3'],
    ['a trailing newline', 'Ender 3\n'],
    ['a tab', 'Ender\t3'],
    ['a NUL character', 'Ender\u00003'],
    ['a number', 42],
    ['null', null],
    ['an array', ['Ender']],
    ['an object', { $ne: '' }],
  ])('rejects %s', (_label, name) => {
    expect(accepts(withField('name', name))).toBe(false);
  });

  it('rejects a missing name', () => {
    const { name: _name, ...withoutName } = valid;

    expect(accepts(withoutName)).toBe(false);
  });

  it('trims the name', () => {
    expect(createPrinterSchema.parse(withField('name', '  Ender 3  ')).name).toBe('Ender 3');
  });

  it('stores composed and decomposed accents as the same text', () => {
    const composed = createPrinterSchema.parse(withField('name', 'Café')).name;
    const decomposed = createPrinterSchema.parse(withField('name', 'Café')).name;

    expect(decomposed).toBe(composed);
    expect(composed).toBe('Café');
  });

  it('counts code points, so 100 emoji fit and 101 do not', () => {
    expect(accepts(withField('name', '🖨'.repeat(100)))).toBe(true);
    expect(accepts(withField('name', '🖨'.repeat(101)))).toBe(false);
  });
});

describe('create printer: build volume', () => {
  const volume = (x: unknown) => withField('buildVolume', { x, y: 1, z: 1 });

  it.each([1, 2000, 220])('accepts %s mm', (x) => {
    expect(accepts(volume(x))).toBe(true);
  });

  it.each([
    ['0', 0],
    ['2001', 2001],
    ['-1', -1],
    ['1.5', 1.5],
    ['a string', '100'],
    ['null', null],
    ['NaN-like text', 'abc'],
  ])('rejects %s', (_label, x) => {
    expect(accepts(volume(x))).toBe(false);
  });

  it('rejects a missing axis', () => {
    expect(accepts(withField('buildVolume', { x: 1, y: 1 }))).toBe(false);
  });

  it('rejects an extra key', () => {
    expect(accepts(withField('buildVolume', { x: 1, y: 1, z: 1, w: 1 }))).toBe(false);
  });

  it('rejects a missing volume', () => {
    const { buildVolume: _volume, ...rest } = valid;

    expect(accepts(rest)).toBe(false);
  });
});

describe('create printer: nozzle', () => {
  const nozzle = (diameterMm: unknown, material: unknown = 'brass') =>
    withField('nozzle', { diameterMm, material });

  it.each([0.2, 0.25, 0.4, 0.6, 0.8, 1, 1.0])('accepts a %s mm diameter', (diameter) => {
    expect(accepts(nozzle(diameter))).toBe(true);
  });

  it.each([0.3, 0, -0.4, 1.2, '0.4', null, undefined])('rejects a %s diameter', (diameter) => {
    expect(accepts(nozzle(diameter))).toBe(false);
  });

  it.each(['brass', 'hardened_steel', 'stainless_steel'])('accepts the %s material', (material) => {
    expect(accepts(nozzle(0.4, material))).toBe(true);
  });

  it.each(['Brass', 'steel', '', null, 3])('rejects the %s material', (material) => {
    expect(accepts(nozzle(0.4, material))).toBe(false);
  });

  it('rejects an extra nozzle key', () => {
    expect(accepts(withField('nozzle', { diameterMm: 0.4, material: 'brass', x: 1 }))).toBe(false);
  });
});

describe('create printer: compatible materials', () => {
  it.each([
    ['one material', ['PLA']],
    [
      'all fourteen',
      [
        'PLA',
        'PETG',
        'ABS',
        'ASA',
        'TPU',
        'PA',
        'PC',
        'HIPS',
        'PVA',
        'PP',
        'PLA_CF',
        'PETG_CF',
        'PA_CF',
        'PA_GF',
      ],
    ],
  ])('accepts %s', (_label, materials) => {
    expect(accepts(withField('compatibleMaterials', materials))).toBe(true);
  });

  it.each([
    ['an empty list', []],
    ['null', null],
    ['a plain string', 'PLA'],
    ['a duplicate', ['PLA', 'PLA']],
    ['an unknown material', ['PLA', 'NYLON']],
    ['lowercase', ['pla']],
    ['a non-string item', [1]],
  ])('rejects %s', (_label, materials) => {
    expect(accepts(withField('compatibleMaterials', materials))).toBe(false);
  });

  it('rejects a missing list', () => {
    const { compatibleMaterials: _list, ...rest } = valid;

    expect(accepts(rest)).toBe(false);
  });
});

describe('create printer: speed and status', () => {
  it.each([1, 1000, 60])('accepts a speed of %s', (speed) => {
    expect(accepts(withField('typicalSpeedMmS', speed))).toBe(true);
  });

  it.each([0, 1001, 12.5, '50', null, -1])('rejects a speed of %s', (speed) => {
    expect(accepts(withField('typicalSpeedMmS', speed))).toBe(false);
  });

  it('allows the speed to be omitted', () => {
    expect(createPrinterSchema.parse(valid)).not.toHaveProperty('typicalSpeedMmS');
  });

  it('defaults the status to available', () => {
    expect(createPrinterSchema.parse(valid).status).toBe('available');
  });

  it.each(['available', 'in_use', 'maintenance'])('accepts the %s status', (status) => {
    expect(createPrinterSchema.parse(withField('status', status)).status).toBe(status);
  });

  it.each(['broken', '', null, 1, 'AVAILABLE'])('rejects the %s status', (status) => {
    expect(accepts(withField('status', status))).toBe(false);
  });
});

describe('create printer: restoreIfDeleted', () => {
  it.each([true, false])('accepts %s', (flag) => {
    expect(createPrinterSchema.parse(withField('restoreIfDeleted', flag)).restoreIfDeleted).toBe(
      flag,
    );
  });

  it('defaults to false when absent', () => {
    expect(createPrinterSchema.parse(valid).restoreIfDeleted).toBe(false);
  });

  it.each(['true', 1, 0, null, 'yes', {}])('rejects %j', (flag) => {
    expect(accepts(withField('restoreIfDeleted', flag))).toBe(false);
  });
});

describe('create printer: unknown and dangerous keys', () => {
  it.each([
    'version',
    'createdAt',
    'updatedAt',
    'archivedAt',
    'deletedAt',
    'id',
    '_id',
    '__v',
    'extra',
    '$set',
    '$where',
    'nozzle.material',
    'a.b',
    'constructor',
  ])('rejects the key %s', (key) => {
    expect(accepts({ ...valid, [key]: 1 })).toBe(false);
  });

  it('rejects an own __proto__ key coming from JSON', () => {
    const body: unknown = JSON.parse(
      `{"__proto__": {"admin": true}, ${JSON.stringify(valid).slice(1)}`,
    );

    expect(accepts(body)).toBe(false);
  });

  it.each([null, undefined, 'text', 5, []])('rejects a body of %s', (body) => {
    expect(accepts(body)).toBe(false);
  });
});

describe('update printer', () => {
  const accepted = (body: unknown): boolean => updatePrinterSchema.safeParse(body).success;

  it('accepts a version with one field', () => {
    expect(accepted({ version: 1, name: 'Prusa' })).toBe(true);
  });

  it('accepts null on the speed to clear it', () => {
    expect(updatePrinterSchema.parse({ version: 3, typicalSpeedMmS: null })).toEqual({
      version: 3,
      typicalSpeedMmS: null,
    });
  });

  it.each([
    ['missing', {}],
    ['a string', { version: '1' }],
    ['zero', { version: 0 }],
    ['negative', { version: -1 }],
    ['fractional', { version: 1.5 }],
    ['null', { version: null }],
  ])('rejects a version that is %s', (_label, versionPart) => {
    expect(accepted({ ...versionPart, name: 'Prusa' })).toBe(false);
  });

  it('rejects a body with only the version', () => {
    expect(accepted({ version: 1 })).toBe(false);
  });

  it('rejects an empty body', () => {
    expect(accepted({})).toBe(false);
  });

  it.each(['name', 'buildVolume', 'nozzle', 'compatibleMaterials', 'status'])(
    'rejects null on the non-nullable %s',
    (field) => {
      expect(accepted({ version: 1, [field]: null })).toBe(false);
    },
  );

  it.each([
    'archivedAt',
    'deletedAt',
    'createdAt',
    'id',
    '_id',
    '$set',
    '$inc',
    'nozzle.material',
    'buildVolume.x',
    'constructor',
  ])('rejects the key %s', (key) => {
    expect(accepted({ version: 1, name: 'Prusa', [key]: 1 })).toBe(false);
  });

  it('requires nested objects whole', () => {
    expect(accepted({ version: 1, buildVolume: { x: 10 } })).toBe(false);
    expect(accepted({ version: 1, nozzle: { diameterMm: 0.4 } })).toBe(false);
  });

  it('applies the same field rules as create', () => {
    expect(accepted({ version: 1, name: 'a'.repeat(101) })).toBe(false);
    expect(accepted({ version: 1, compatibleMaterials: ['PLA', 'PLA'] })).toBe(false);
    expect(accepted({ version: 1, typicalSpeedMmS: 0 })).toBe(false);
  });
});

describe('path parameters', () => {
  const accepted = (id: unknown): boolean => printerIdParamsSchema.safeParse({ id }).success;

  it('accepts 24 hexadecimal characters', () => {
    expect(accepted('66f0c0ffee0123456789abcd')).toBe(true);
  });

  it.each([
    '',
    'abc',
    '66f0c0ffee0123456789abc',
    '66f0c0ffee0123456789abcde',
    'zzf0c0ffee0123456789abcd',
    '{"$ne":1}',
  ])('rejects the id "%s"', (id) => {
    expect(accepted(id)).toBe(false);
  });
});

describe('list query', () => {
  const parse = (query: unknown) => listPrintersQuerySchema.safeParse(query);

  it('applies the defaults', () => {
    expect(parse({})).toMatchObject({
      success: true,
      data: { page: 1, pageSize: 20, sort: 'name', order: 'asc' },
    });
  });

  it('parses numbers sent as text', () => {
    expect(parse({ page: '3', pageSize: '100' })).toMatchObject({
      success: true,
      data: { page: 3, pageSize: 100 },
    });
  });

  it.each([
    { pageSize: '0' },
    { pageSize: '101' },
    { page: '0' },
    { page: '10001' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1e2' },
    { page: '' },
    { page: ['1', '2'] },
    { status: 'broken' },
    { status: ['available', 'in_use'] },
    { 'status[$ne]': 'x' },
    { sort: 'version' },
    { sort: 'deletedAt' },
    { sort: '$natural' },
    { order: 'sideways' },
    { unknown: '1' },
  ])('rejects %j', (query) => {
    expect(parse(query).success).toBe(false);
  });

  it('accepts the maximum page', () => {
    expect(parse({ page: '10000' }).success).toBe(true);
  });
});
