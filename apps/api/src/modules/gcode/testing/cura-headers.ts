// Fixtures for the Cura header parser.
//
// IMPORTANT: these two heads were RECONSTRUCTED from the CuraEngine source, not copied from files
// Cura wrote (ADR 0014). Before the import is trusted, add the first 64 KB of real .gcode files
// from the printers in use (Cura 4.x and 5.x, one and two extruders) as extra fixtures.

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
