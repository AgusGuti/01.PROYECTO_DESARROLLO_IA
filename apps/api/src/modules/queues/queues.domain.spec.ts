import { describe, expect, it } from 'vitest';
import { lineIssues, pendingOf, printerSelectionIssues, queueTotals } from './queues.domain.js';
import { line, PART_A, PART_B, PART_C } from './testing/fakes.js';

describe('pendingOf', () => {
  it.each([
    [4, 1, 3],
    [4, 4, 0],
    [1, 0, 1],
  ])('quantity %i with %i completed leaves %i pending', (quantity, completed, pending) => {
    expect(pendingOf({ quantity, completed })).toBe(pending);
  });
});

describe('lineIssues', () => {
  it('accepts distinct parts with completed up to the quantity', () => {
    expect(lineIssues([line(PART_A, 4, 4), line(PART_B, 1, 0)])).toEqual([]);
  });

  it('reports a repeated part and an excess of completed with their indexed paths', () => {
    expect(lineIssues([line(PART_A, 2), line(PART_B, 2, 3), line(PART_A, 1)])).toEqual([
      { path: 'lines.1.completed', message: 'Must not be more than the quantity.' },
      { path: 'lines.2.partId', message: 'The part is repeated.' },
    ]);
  });
});

describe('printerSelectionIssues', () => {
  it.each([
    ['single', ['p1'], 0],
    ['single', [], 1],
    ['single', ['p1', 'p2'], 1],
    ['multi', ['p1'], 1],
    ['multi', ['p1', 'p2'], 0],
    ['multi', Array.from({ length: 10 }, (_, i) => `p${String(i)}`), 0],
    ['multi', Array.from({ length: 11 }, (_, i) => `p${String(i)}`), 1],
  ] as const)('%s mode with %j gives %i count issue(s)', (mode, ids, expected) => {
    expect(printerSelectionIssues(mode, ids)).toHaveLength(expected);
  });

  it('reports a repeated printer at its index even when the mode is unknown', () => {
    expect(printerSelectionIssues(undefined, ['p1', 'p2', 'p1'])).toEqual([
      { path: 'printerIds.2', message: 'The printer is repeated.' },
    ]);
  });
});

describe('queueTotals', () => {
  const parts = new Map([
    [PART_A, { name: 'A', estimatedPrintSeconds: 3600 }],
    [PART_B, { name: 'B', estimatedPrintSeconds: 600 }],
  ]);

  it('sums units, and seconds as pending times print time (hand-computed)', () => {
    // A: 4 total, 1 done, 3 pending x 3600 = 10800. B: 2 total, 0 done x 600 = 1200.
    // C: 5 total, 5 done, nothing pending.
    const lines = [line(PART_A, 4, 1), line(PART_B, 2, 0), line(PART_C, 5, 5)];

    expect(queueTotals(lines, parts)).toEqual({
      totalUnits: 11,
      completedUnits: 6,
      pendingUnits: 5,
      pendingSeconds: 12_000,
    });
  });

  it('counts the pending units of a deleted part but gives them 0 seconds', () => {
    expect(queueTotals([line(PART_C, 3, 1)], parts)).toEqual({
      totalUnits: 3,
      completedUnits: 1,
      pendingUnits: 2,
      pendingSeconds: 0,
    });
  });

  it('is all zeros for an empty queue', () => {
    expect(queueTotals([], parts)).toEqual({
      totalUnits: 0,
      completedUnits: 0,
      pendingUnits: 0,
      pendingSeconds: 0,
    });
  });

  it('returns null when the seconds leave the safe-integer range', () => {
    const huge = new Map([[PART_A, { name: 'A', estimatedPrintSeconds: 10_000_000_000_000 }]]);

    expect(queueTotals([line(PART_A, 1000)], huge)).toBeNull();
  });
});
