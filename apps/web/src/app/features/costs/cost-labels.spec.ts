import {
  basisPointsToPercentInput,
  formatMoney,
  formatPercent,
  isWarningCode,
  MATERIAL_LABELS,
  minorToPesosInput,
  parsePercentToBasisPoints,
  parsePesosToMinor,
  WARNING_MESSAGES,
} from './cost-labels';

/** Intl puts a no-break space after "$"; tests compare with a plain one. */
const money = (minor: number) => formatMoney(minor).replace(/\s/g, ' ');

describe('parsePesosToMinor', () => {
  it.each([
    ['15000', 1_500_000],
    ['15000,5', 1_500_050],
    ['0,01', 1],
    ['0', 0],
    ['  8,25 ', 825],
    ['10000000', 1_000_000_000],
    ['10000000,00', 1_000_000_000],
    ['9999999,99', 999_999_999],
  ])('turns %j into %i centavos', (text, minor) => {
    expect(parsePesosToMinor(text)).toBe(minor);
  });

  it.each([
    '',
    'abc',
    '-1',
    '1,234',
    '1.5',
    '10000000,01',
    '12345678',
    '99999999',
    '10000001',
    '1,',
  ])('rejects %j', (text) => {
    expect(parsePesosToMinor(text)).toBeNull();
  });
});

describe('minorToPesosInput', () => {
  it('writes whole pesos without decimals and keeps two digits for centavos', () => {
    expect(minorToPesosInput(1_500_000)).toBe('15000');
    expect(minorToPesosInput(1_500_050)).toBe('15000,50');
    expect(minorToPesosInput(1)).toBe('0,01');
    expect(minorToPesosInput(0)).toBe('0');
  });
});

describe('formatMoney', () => {
  it('formats centavos as Argentine pesos with a dot for thousands and a comma for decimals', () => {
    expect(money(414_240)).toBe('$ 4.142,40');
    expect(money(517_800)).toBe('$ 5.178,00');
    expect(money(1)).toBe('$ 0,01');
    expect(money(0)).toBe('$ 0,00');
  });
});

describe('parsePercentToBasisPoints', () => {
  it.each([
    ['12,5', 1250],
    ['12.5', 1250],
    ['0,01', 1],
    ['25', 2500],
    ['100', 10_000],
    ['1000', 100_000],
    ['1000,00', 100_000],
    [' 7,25 ', 725],
    ['0', 0],
  ])('turns %j into %i basis points', (text, basisPoints) => {
    expect(parsePercentToBasisPoints(text)).toBe(basisPoints);
  });

  it.each(['', 'abc', '12,345', '-5', '1000,01', '1001', '12,', ',5', '1e2', '12 %', '1,2,3'])(
    'rejects %j',
    (text) => {
      expect(parsePercentToBasisPoints(text)).toBeNull();
    },
  );
});

describe('basisPointsToPercentInput', () => {
  it('writes the shortest comma form and round-trips with the parser', () => {
    expect(basisPointsToPercentInput(1250)).toBe('12,5');
    expect(basisPointsToPercentInput(2500)).toBe('25');
    expect(basisPointsToPercentInput(1)).toBe('0,01');
    expect(basisPointsToPercentInput(10)).toBe('0,1');
    expect(basisPointsToPercentInput(0)).toBe('0');
    expect(basisPointsToPercentInput(100_000)).toBe('1000');
    for (const basisPoints of [0, 1, 10, 725, 1250, 2500, 99_999]) {
      expect(parsePercentToBasisPoints(basisPointsToPercentInput(basisPoints))).toBe(basisPoints);
    }
  });

  it('formats a percentage for display', () => {
    expect(formatPercent(2500)).toBe('25 %');
    expect(formatPercent(1250)).toBe('12,5 %');
  });
});

describe('labels', () => {
  it('has a Spanish message for each of the four warning codes', () => {
    expect(Object.keys(WARNING_MESSAGES).sort()).toEqual([
      'electricity_printer_not_selected',
      'electricity_printer_power_unknown',
      'filament_insufficient',
      'settings_not_configured',
    ]);
    expect(isWarningCode('filament_insufficient')).toBe(true);
    expect(isWarningCode('toString')).toBe(false);
    expect(isWarningCode(3)).toBe(false);
  });

  it('labels the 14 materials in Spanish', () => {
    expect(Object.keys(MATERIAL_LABELS)).toHaveLength(14);
    expect(MATERIAL_LABELS.PA_CF).toBe('Nailon con fibra de carbono (PA-CF)');
  });
});
