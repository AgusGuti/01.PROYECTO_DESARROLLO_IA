import {
  basisPointsToPercentInput,
  parseMinutes,
  parsePercentToBasisPoints,
} from './planning-labels';

describe('parseMinutes', () => {
  it.each([
    ['0', 0],
    ['15', 15],
    ['240', 240],
    [' 30 ', 30],
  ])('converts %j to %i minutes', (text, minutes) => {
    expect(parseMinutes(text)).toBe(minutes);
  });

  it.each(['', 'abc', '241', '-1', '1,5', '1.5', '1e1', '1000'])('rejects %j', (text) => {
    expect(parseMinutes(text)).toBeNull();
  });
});

describe('parsePercentToBasisPoints', () => {
  it.each([
    ['0', 0],
    ['12,5', 1250],
    ['12.5', 1250],
    ['0,01', 1],
    ['7', 700],
    ['50', 5000],
    ['50,00', 5000],
    [' 30 ', 3000],
  ])('converts %j to %i basis points', (text, basisPoints) => {
    expect(parsePercentToBasisPoints(text)).toBe(basisPoints);
  });

  it.each(['', 'abc', '50,01', '51', '100', '-1', '1,234', '1,2,3', '12,', ',5', '1.000,5', '1e1'])(
    'rejects %j',
    (text) => {
      expect(parsePercentToBasisPoints(text)).toBeNull();
    },
  );
});

describe('basisPointsToPercentInput', () => {
  it.each([
    [0, '0'],
    [1250, '12,5'],
    [1, '0,01'],
    [5000, '50'],
    [1225, '12,25'],
  ])('shows %i basis points as %j', (basisPoints, text) => {
    expect(basisPointsToPercentInput(basisPoints)).toBe(text);
  });
});
