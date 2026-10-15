// Fixtures for the Cura header parser.
//
// CURA_4_13_HEAD and CURA_5_7_HEAD were RECONSTRUCTED from the CuraEngine source (ADR 0014).
// The three REAL_* heads below are the first lines of real files written by Cura 5.10 and 5.11
// for a Creality Ender-3 V2 Neo (only the comment header and the first start commands; nothing of
// the model). Still missing: a real Cura 4.x head and a real two-extruder head.

const lines = (...values: string[]): string => `${values.join('\n')}\n`;

export const CURA_4_13_HEAD = lines(
  ';FLAVOR:Marlin',
  ';TIME:7421',
  ';Filament used: 12.4821m',
  ';Layer height: 0.2',
  ';MINX:71.7',
  ';MINY:76.7',
  ';MINZ:0.2',
  ';MAXX:163.3',
  ';MAXY:158.3',
  ';MAXZ:45.2',
  ';Generated with Cura_SteamEngine 4.13.1',
  'M140 S60',
  'M105',
);

export const CURA_5_7_HEAD = lines(
  ';FLAVOR:Marlin',
  ';TIME:2305',
  ';Filament used: 1.89182m',
  ';Layer height: 0.16',
  ';MINX:98.4',
  ';MINY:98.4',
  ';MINZ:0.16',
  ';MAXX:121.6',
  ';MAXY:121.6',
  ';MAXZ:20.16',
  ';TARGET_MACHINE.NAME:Creality Ender-3 Pro',
  ';Generated with Cura_SteamEngine 5.7.1',
  'M140 S60',
  'M105',
);

/** A valid head with every line replaceable, for tests that change one value at a time. */
export function headWith(overrides: Readonly<Record<string, string | null>> = {}): string {
  const merged = new Map<string, string>([
    ['FLAVOR', ';FLAVOR:Marlin'],
    ['TIME', ';TIME:2305'],
    ['FILAMENT', ';Filament used: 1.89182m'],
    ['LAYER', ';Layer height: 0.16'],
    ['MINX', ';MINX:98.4'],
    ['MINY', ';MINY:98.4'],
    ['MAXX', ';MAXX:121.6'],
    ['MAXY', ';MAXY:121.6'],
    ['MAXZ', ';MAXZ:20.16'],
    ['GENERATED', ';Generated with Cura_SteamEngine 5.7.1'],
  ]);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) merged.delete(key);
    else merged.set(key, value);
  }
  return lines(...merged.values(), 'M140 S60');
}

const REAL_START = ['M140 S60', 'M105', 'M190 S60', 'M104 S200', 'M105', 'M109 S200'];

export const REAL_CURA_5_10_BEAR_HEAD = lines(
  ';FLAVOR:Marlin',
  ';TIME:64440',
  ';Filament used: 41.9712m',
  ';Layer height: 0.2',
  ';MINX:60.174',
  ';MINY:11.694',
  ';MINZ:0.2',
  ';MAXX:169.827',
  ';MAXY:214.303',
  ';MAXZ:75.2',
  ';TARGET_MACHINE.NAME:Creality Ender-3 v2 Neo',
  ';Generated with Cura_SteamEngine 5.10.0',
  ...REAL_START,
);

export const REAL_CURA_5_10_VASE_HEAD = lines(
  ';FLAVOR:Marlin',
  ';TIME:12973',
  ';Filament used: 6.21088m',
  ';Layer height: 0.12',
  ';MINX:80.844',
  ';MINY:34.033',
  ';MINZ:0.12',
  ';MAXX:178.877',
  ';MAXY:131.206',
  ';MAXZ:100.027',
  ';TARGET_MACHINE.NAME:Creality Ender-3 v2 Neo',
  ';Generated with Cura_SteamEngine 5.10.0',
  ...REAL_START,
);

export const REAL_CURA_5_11_PIN_HEAD = lines(
  ';FLAVOR:Marlin',
  ';TIME:4421',
  ';Filament used: 1.09139m',
  ';Layer height: 0.12',
  ';MINX:0',
  ';MINY:0',
  ';MINZ:0.12',
  ';MAXX:193.495',
  ';MAXY:92.494',
  ';MAXZ:5.76',
  ';TARGET_MACHINE.NAME:Creality Ender-3 v2 Neo',
  ';Generated with Cura_SteamEngine 5.11.0',
  ...REAL_START,
);
