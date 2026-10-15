import { describe, expect, it } from 'vitest';
import { FILAMENT_DENSITY_G_CM3, MATERIALS } from '../../shared/catalog/materials.js';
import { gramsFromFilamentLength, parseCuraHeader, type CuraHeader } from './gcode.domain.js';
import { CURA_4_13_HEAD, CURA_5_7_HEAD, headWith } from './testing/cura-headers.js';

function headerOf(head: string): CuraHeader {
  const result = parseCuraHeader(head);
  if (result.status !== 'ok') throw new Error(`expected a header, got ${result.status}`);
  return result.header;
}

const statusOf = (head: string): string => parseCuraHeader(head).status;

// Generous on purpose: the parser takes well under 10 ms; this only catches a runaway regex.
const BUDGET_MS = 1000;

function timeOf(head: string): { status: string; ms: number } {
  const started = performance.now();
  const status = statusOf(head);
  return { status, ms: performance.now() - started };
}

describe('parseCuraHeader: the two reconstructed Cura heads', () => {
  it('reads Cura 4.13.1', () => {
    expect(headerOf(CURA_4_13_HEAD)).toEqual({
      estimatedPrintSeconds: 7421,
      filamentMm: 12_482,
      extrudersUsed: 1,
      layerHeightUm: 200,
      dimensionsMm: { x: 92, y: 82, z: 46 },
      targetMachineName: null,
    });
  });

  it('reads Cura 5.7.1 with its machine name', () => {
    expect(headerOf(CURA_5_7_HEAD)).toEqual({
      estimatedPrintSeconds: 2305,
      filamentMm: 1892,
      extrudersUsed: 1,
      layerHeightUm: 160,
      dimensionsMm: { x: 24, y: 24, z: 21 },
      targetMachineName: 'Creality Ender-3 Pro',
    });
  });

  it('reads RepRap flavour too', () => {
    expect(statusOf(headWith({ FLAVOR: ';FLAVOR:RepRap' }))).toBe('ok');
  });

  it('reads a head with CRLF line endings', () => {
    expect(headerOf(CURA_5_7_HEAD.replaceAll('\n', '\r\n'))).toEqual(headerOf(CURA_5_7_HEAD));
  });

  it('reads a head with a leading byte order mark', () => {
    expect(headerOf(`${String.fromCharCode(0xfeff)}${CURA_5_7_HEAD}`)).toEqual(
      headerOf(CURA_5_7_HEAD),
    );
  });

  it('skips blank lines inside the comment block', () => {
    expect(headerOf(CURA_5_7_HEAD.replace(';TIME', '\n\n;TIME'))).toEqual(headerOf(CURA_5_7_HEAD));
  });

  it('reads a head that ends right after the last comment, with no newline', () => {
    expect(statusOf(CURA_5_7_HEAD.split('M140')[0]?.trimEnd() ?? '')).toBe('ok');
  });

  it('stops at the first line that is not a comment', () => {
    const afterCode = headWith({ MAXZ: null }).replace(
      'M140 S60',
      'M140 S60\n;MAXZ:20.16\n;TIME:1',
    );

    // Lines after the first G-code line are not read: MAXZ stays missing and TIME stays 2305.
    expect(headerOf(afterCode)).toMatchObject({ estimatedPrintSeconds: 2305, dimensionsMm: null });
  });
});

describe('parseCuraHeader: what is not a supported header', () => {
  it.each([
    ['an empty text', ''],
    ['plain text', 'hello world'],
    ['no Cura_SteamEngine line', headWith({ GENERATED: null })],
    ['another slicer', headWith({ GENERATED: ';Generated with PrusaSlicer 2.7' })],
    [
      'a Cura_SteamEngine line without the trailing space',
      headWith({ GENERATED: ';Generated with Cura_SteamEngine' }),
    ],
    ['no FLAVOR line', headWith({ FLAVOR: null })],
    ['FLAVOR Griffin', headWith({ FLAVOR: ';FLAVOR:Griffin' })],
    ['FLAVOR UltiGCode', headWith({ FLAVOR: ';FLAVOR:UltiGCode' })],
    ['FLAVOR Marlin(Volumetric)', headWith({ FLAVOR: ';FLAVOR:Marlin(Volumetric)' })],
    ['a lowercase flavor', headWith({ FLAVOR: ';FLAVOR:marlin' })],
    ['a flavor with a suffix', headWith({ FLAVOR: ';FLAVOR:Marlin2' })],
    [
      'a first Griffin flavor and a later Marlin',
      headWith({ FLAVOR: ';FLAVOR:Griffin\n;FLAVOR:Marlin' }),
    ],
    ['G-code first and the header after', `G28\n${CURA_5_7_HEAD}`],
    ['a Cura line that is indented', CURA_5_7_HEAD.replace(';Generated', ' ;Generated')],
  ])('answers unsupported for %s', (_label, head) => {
    expect(statusOf(head)).toBe('unsupported');
  });
});

describe('parseCuraHeader: Cura header without a usable time or filament', () => {
  it('answers unusable for the 6666 seconds and 0 m placeholder', () => {
    expect(statusOf(headWith({ TIME: ';TIME:6666', FILAMENT: ';Filament used: 0m' }))).toBe(
      'unusable',
    );
  });

  it('keeps 6666 seconds when there is real filament', () => {
    expect(headerOf(headWith({ TIME: ';TIME:6666' })).estimatedPrintSeconds).toBe(6666);
  });

  it('answers unusable when the time line is missing', () => {
    expect(statusOf(headWith({ TIME: null }))).toBe('unusable');
  });

  it('answers unusable when the filament line is missing', () => {
    expect(statusOf(headWith({ FILAMENT: null }))).toBe('unusable');
  });
});

describe('parseCuraHeader: hostile time values', () => {
  it.each([
    '-5',
    '0',
    '2592001',
    '99999999999',
    '1e999',
    '1e3',
    'NaN',
    'Infinity',
    '-Infinity',
    '0x10',
    '1.5',
    '12 seconds',
    '',
    '٣',
  ])('drops the header for ;TIME:%s', (value) => {
    expect(statusOf(headWith({ TIME: `;TIME:${value}` }))).toBe('unusable');
  });

  it.each([
    ['1', 1],
    ['2592000', 2_592_000],
    ['  300  ', 300],
  ])('accepts ;TIME:%s', (value, seconds) => {
    expect(headerOf(headWith({ TIME: `;TIME:${value}` })).estimatedPrintSeconds).toBe(seconds);
  });
});

describe('parseCuraHeader: hostile filament values', () => {
  it.each([
    '0m',
    '0.0004m',
    '1e-05m',
    '-1m',
    'nanm',
    'infm',
    'Infinitym',
    '1.5',
    '1.5 m',
    '1.5mm',
    '1.5m3',
    '999999m',
    '100000.001m',
    '1234567m',
    '1.1234567m',
    '',
    '1m,',
    '1m 2m',
    '1m, 1m, 1m, 1m, 1m, 1m, 1m, 1m, 1m',
    '0m, 0m',
  ])('drops the header for ;Filament used: %s', (value) => {
    expect(statusOf(headWith({ FILAMENT: `;Filament used: ${value}` }))).toBe('unusable');
  });

  it.each([
    ['0.001m', 1],
    ['0.0005m', 1],
    ['12.4821m', 12_482],
    ['1.89182m', 1892],
    ['100000m', 100_000_000],
  ])('converts ;Filament used: %s to %i mm', (value, mm) => {
    expect(headerOf(headWith({ FILAMENT: `;Filament used: ${value}` })).filamentMm).toBe(mm);
  });

  it('adds the extruders together', () => {
    const header = headerOf(headWith({ FILAMENT: ';Filament used: 1.5m, 2.25m' }));

    expect(header.filamentMm).toBe(3750);
    expect(header.extrudersUsed).toBe(2);
  });

  it('adds up to eight extruders', () => {
    const header = headerOf(
      headWith({ FILAMENT: `;Filament used: ${Array(8).fill('1m').join(', ')}` }),
    );

    expect(header).toMatchObject({ filamentMm: 8000, extrudersUsed: 8 });
  });

  it('does not count an extruder that pushed nothing', () => {
    const header = headerOf(headWith({ FILAMENT: ';Filament used: 1m, 0m' }));

    expect(header).toMatchObject({ filamentMm: 1000, extrudersUsed: 1 });
  });
});

describe('parseCuraHeader: layer height', () => {
  it.each([
    ['0.2', 200],
    ['0.16', 160],
    ['0.01', 10],
    ['2', 2000],
    ['2.0', 2000],
    ['0.0625', 63],
  ])('converts %s mm to %i um', (value, um) => {
    expect(headerOf(headWith({ LAYER: `;Layer height: ${value}` })).layerHeightUm).toBe(um);
  });

  it.each(['0', '0.009', '2.001', '-0.2', '1e-1', 'abc', '', '0,2', '123', '0.2mm'])(
    'drops the layer height %s but keeps the rest',
    (value) => {
      const header = headerOf(headWith({ LAYER: `;Layer height: ${value}` }));

      expect(header.layerHeightUm).toBeNull();
      expect(header.estimatedPrintSeconds).toBe(2305);
    },
  );

  it('is null when the line is missing', () => {
    expect(headerOf(headWith({ LAYER: null })).layerHeightUm).toBeNull();
  });
});

describe('parseCuraHeader: dimensions', () => {
  const box = (minX: string, maxX: string, maxZ = '10') =>
    headerOf(headWith({ MINX: `;MINX:${minX}`, MAXX: `;MAXX:${maxX}`, MAXZ: `;MAXZ:${maxZ}` }))
      .dimensionsMm;

  it('does not turn 100.3 - 0.3 into 101 (integer micrometres, no float error)', () => {
    expect(box('0.3', '100.3')).toMatchObject({ x: 100 });
  });

  it('rounds up to whole millimetres', () => {
    expect(box('0', '10.001')).toMatchObject({ x: 11 });
    expect(box('0', '10')).toMatchObject({ x: 10 });
    expect(box('0', '0.001')).toMatchObject({ x: 1 });
  });

  it('works with negative coordinates', () => {
    expect(box('-50.5', '49.5')).toMatchObject({ x: 100 });
  });

  it('uses MAXZ rounded up for the height', () => {
    expect(box('0', '10', '45.2')).toMatchObject({ z: 46 });
    expect(box('0', '10', '45')).toMatchObject({ z: 45 });
  });

  it('accepts a side of exactly 1000 mm', () => {
    expect(box('-500', '500')).toMatchObject({ x: 1000 });
  });

  it.each([
    ['a side over 1000 mm', '-1000', '1000'],
    ['a side of 1000.001 mm', '0', '1000.001'],
    ['a coordinate beyond +1000', '0', '1000.001'],
    ['a coordinate beyond -1000', '-1000.001', '0'],
    ['a zero-width side', '5', '5'],
    ['a negative-width side', '10', '5'],
    ['a coordinate with six integer digits', '0', '100000'],
    ['a coordinate in exponent form', '0', '1e2'],
    ['a coordinate that is NaN', '0', 'NaN'],
    ['an empty coordinate', '0', ''],
  ])('gives null dimensions for %s', (_label, minX, maxX) => {
    expect(box(minX, maxX)).toBeNull();
  });

  it('gives null when MAXZ is zero, negative or too tall', () => {
    expect(box('0', '10', '0')).toBeNull();
    expect(box('0', '10', '-3')).toBeNull();
    expect(box('0', '10', '1000.5')).toBeNull();
  });

  it('gives null when any needed coordinate is missing', () => {
    for (const key of ['MINX', 'MINY', 'MAXX', 'MAXY', 'MAXZ']) {
      expect(headerOf(headWith({ [key]: null })).dimensionsMm).toBeNull();
    }
  });

  it('does not need MINZ', () => {
    expect(headerOf(CURA_5_7_HEAD.replace(';MINZ:0.16\n', '')).dimensionsMm).not.toBeNull();
  });
});

describe('parseCuraHeader: target machine name', () => {
  const nameOf = (value: string): string | null =>
    headerOf(headWith({ MACHINE: `;TARGET_MACHINE.NAME:${value}` })).targetMachineName;

  it('keeps printable ASCII', () => {
    expect(nameOf('Creality Ender-3 Pro')).toBe('Creality Ender-3 Pro');
    expect(nameOf('a'.repeat(100))).toBe('a'.repeat(100));
  });

  it.each([
    ['over 100 characters', 'a'.repeat(101)],
    ['non-ASCII letters', 'Ender é'],
    ['an emoji', 'Ender 🧵'],
    ['a control character', 'Ender\u0007'],
    ['a tab inside', 'Ender\t3'],
    ['nothing', ''],
    ['only spaces', '   '],
  ])('drops a name with %s', (_label, value) => {
    expect(nameOf(value)).toBeNull();
  });

  it('keeps an HTML-looking name as inert text (the page shows it as text)', () => {
    expect(nameOf('<b>x</b>')).toBe('<b>x</b>');
  });
});

describe('parseCuraHeader: duplicate keys', () => {
  it('keeps the first value of each key', () => {
    const head = CURA_5_7_HEAD.replace(
      ';Generated',
      ';TIME:1\n;Filament used: 99m\n;Layer height: 1\n;MAXZ:5\n;TARGET_MACHINE.NAME:Evil\n;Generated',
    );

    expect(headerOf(head)).toEqual(headerOf(CURA_5_7_HEAD));
  });

  it('keeps a first invalid value instead of falling back to a later valid one', () => {
    expect(statusOf(headWith({ TIME: ';TIME:-5\n;TIME:100' }))).toBe('unusable');
  });
});

describe('parseCuraHeader: limits and hostile text', () => {
  it('never returns NaN or Infinity, whatever the values', () => {
    const hostile = ['NaN', '1e999', '-1e999', 'Infinity', '0x1F', '9'.repeat(400)];

    for (const value of hostile) {
      const results = [
        headWith({ TIME: `;TIME:${value}` }),
        headWith({ FILAMENT: `;Filament used: ${value}m` }),
        headWith({ LAYER: `;Layer height: ${value}` }),
        headWith({ MINX: `;MINX:${value}`, MAXZ: `;MAXZ:${value}` }),
      ].map(parseCuraHeader);
      for (const result of results) {
        if (result.status === 'ok') {
          const numbers = [
            result.header.estimatedPrintSeconds,
            result.header.filamentMm,
            result.header.layerHeightUm ?? 0,
            result.header.dimensionsMm?.x ?? 0,
            result.header.dimensionsMm?.y ?? 0,
            result.header.dimensionsMm?.z ?? 0,
          ];
          for (const number of numbers) expect(Number.isFinite(number)).toBe(true);
        }
      }
    }
  });

  it('ignores a line over 500 characters', () => {
    const long = headWith({ TIME: `;TIME:${'1'.repeat(600)}` });

    expect(statusOf(long)).toBe('unusable');
  });

  it('reads a line of exactly 500 characters', () => {
    const padded = `;TARGET_MACHINE.NAME:${'a'.repeat(100)}${' '.repeat(500 - 21 - 100)}`;

    expect(padded).toHaveLength(500);
    expect(headerOf(headWith({ MACHINE: padded })).targetMachineName).toBe('a'.repeat(100));
  });

  it('reads only the first 2000 lines', () => {
    const filler = Array.from({ length: 2000 }, () => ';x').join('\n');

    expect(statusOf(`${filler}\n${CURA_5_7_HEAD}`)).toBe('unsupported');
    expect(
      statusOf(`${Array.from({ length: 1000 }, () => ';x').join('\n')}\n${CURA_5_7_HEAD}`),
    ).toBe('ok');
  });

  it('reads line 2000 but not line 2001', () => {
    // headWith writes 10 comment lines and the Cura_SteamEngine line is the last of them.
    const filler = (count: number): string => Array.from({ length: count }, () => ';x').join('\n');

    expect(statusOf(`${filler(1990)}\n${headWith()}`)).toBe('ok');
    expect(statusOf(`${filler(1991)}\n${headWith()}`)).toBe('unsupported');
  });

  it('reads only the first 65536 characters', () => {
    // Skipped 600-character lines use up space without ever being parsed.
    const line = `;${'x'.repeat(599)}\n`;
    const near = line.repeat(100) + CURA_5_7_HEAD;
    const past = line.repeat(110) + CURA_5_7_HEAD;

    expect(near.length).toBeLessThan(65_536);
    expect(past.length).toBeGreaterThan(65_536);
    expect(statusOf(near)).toBe('ok');
    expect(statusOf(past)).toBe('unsupported');
  });
});

describe('parseCuraHeader: hostile input finishes within a fixed budget', () => {
  const hostileHeads: [string, string][] = [
    ['64 KB of semicolons in one line', ';'.repeat(65_536)],
    ['64 KB of semicolon lines', ';;;;\n'.repeat(13_107)],
    ['64 KB of digits', '1'.repeat(65_536)],
    ['64 KB of digit lines', '1234567890\n'.repeat(5958)],
    ['one 64 KB comment line without a newline', `;${'a'.repeat(65_535)}`],
    ['2001 comment lines', Array.from({ length: 2001 }, () => ';TIME:1').join('\n')],
    ['600-character comment lines', `;${'a'.repeat(599)}\n`.repeat(100)],
    ['600-character key lines', `;Filament used: ${'1'.repeat(600)}m\n`.repeat(100)],
    [
      ';MINX: followed by 60000 digits',
      `${CURA_5_7_HEAD.split('\n')[0] ?? ''}\n;MINX:${'9'.repeat(60_000)}`,
    ],
    ['a long run of digits then a dot', `;Filament used: ${'9'.repeat(450)}.${'9'.repeat(30)}`],
    ['a long comma list', `;Filament used: ${'1m,'.repeat(150)}`],
    ['a head of only carriage returns', '\r'.repeat(65_536)],
    ['a head of only newlines', '\n'.repeat(65_536)],
    ['a head of spaces then a comment', `${' '.repeat(65_000)};TIME:1`],
  ];

  it.each(hostileHeads)('handles %s', (_label, head) => {
    const { status, ms } = timeOf(head);

    expect(['unsupported', 'unusable']).toContain(status);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  // The cases above stop at the recognition check. These keep the head recognised, so every value
  // regex runs against the hostile text, and they require that it was NOT rejected as unsupported.
  const hostileValues: [string, Record<string, string>][] = [
    ['400 digits as the time', { TIME: `;TIME:${'9'.repeat(400)}` }],
    ['490 digits as the time', { TIME: `;TIME:${'1'.repeat(490)}` }],
    [
      'a long digit run then a dot in the filament',
      { FILAMENT: `;Filament used: ${'9'.repeat(450)}.${'9'.repeat(30)}m` },
    ],
    ['a long comma list in the filament', { FILAMENT: `;Filament used: ${'1m,'.repeat(150)}` }],
    [
      'repeated "1." fragments in the filament',
      { FILAMENT: `;Filament used: ${'1.'.repeat(240)}m` },
    ],
    ['an unterminated filament value', { FILAMENT: `;Filament used: ${'1'.repeat(480)}` }],
    ['a long layer height', { LAYER: `;Layer height: ${'0'.repeat(480)}.1` }],
    ['a long coordinate', { MINX: `;MINX:${'9'.repeat(480)}` }],
    [
      'a long negative coordinate with a dot',
      { MAXX: `;MAXX:-${'9'.repeat(240)}.${'9'.repeat(240)}` },
    ],
    ['a machine name of 480 characters', { MACHINE: `;TARGET_MACHINE.NAME:${'a'.repeat(470)}` }],
    ['a machine name made of spaces', { MACHINE: `;TARGET_MACHINE.NAME:${' '.repeat(470)}` }],
  ];

  it.each(hostileValues)(
    'keeps the head recognised and finishes fast with %s',
    (_label, overrides) => {
      const { status, ms } = timeOf(headWith(overrides));

      expect(status).not.toBe('unsupported');
      expect(ms).toBeLessThan(BUDGET_MS);
    },
  );

  it('handles a valid head padded to 64 KB with comment lines', () => {
    const head = `${CURA_5_7_HEAD.split('M140')[0] ?? ''}${';pad\n'.repeat(1900)}`;

    const { status, ms } = timeOf(head);

    expect(status).toBe('ok');
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('gramsFromFilamentLength', () => {
  it('gives about 37 g for the Cura 4.13.1 head in PLA', () => {
    // 12482 mm x 2.40528 mm2 = 30.02 cm3 x 1.24 g/cm3 = 37.2 g (the design estimate).
    expect(gramsFromFilamentLength(12_482, 'PLA')).toBe(37);
  });

  it('gives about 6 g for the Cura 5.7.1 head in PLA', () => {
    expect(gramsFromFilamentLength(1892, 'PLA')).toBe(6);
  });

  it.each([
    [100_000, 'PETG', 305],
    [10_000, 'PP', 22],
    [1, 'PLA', 0],
  ] as const)('gives %i mm of %s as %i g', (mm, material, grams) => {
    expect(gramsFromFilamentLength(mm, material)).toBe(grams);
  });

  it.each(MATERIALS)('follows the formula for %s', (material) => {
    for (const mm of [1, 999, 12_482, 1_000_000]) {
      const expected = Math.round(
        (mm * Math.PI * 0.875 ** 2 * FILAMENT_DENSITY_G_CM3[material]) / 1000,
      );

      expect(gramsFromFilamentLength(mm, material)).toBe(expected);
    }
  });
});
