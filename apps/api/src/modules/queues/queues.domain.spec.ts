import { describe, expect, it } from 'vitest';
import {
  lineIssues,
  lockedLineIssues,
  missingSpoolIssues,
  newQueueLineIssues,
  pendingOf,
  printerSelectionIssues,
  queueTotals,
} from './queues.domain.js';
import { line, PART_A, PART_B, PART_C, SPOOL_1, SPOOL_2 } from './testing/fakes.js';

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

  it('reports a repeated pair and an excess of completed with their indexed paths', () => {
    expect(lineIssues([line(PART_A, 2), line(PART_B, 2, 3), line(PART_A, 1)])).toEqual([
      { path: 'lines.1.completed', message: 'Must not be more than the quantity.' },
      { path: 'lines.2.filamentId', message: 'The part and spool are repeated.' },
    ]);
  });

  it('allows the same part on several lines with different spools', () => {
    expect(lineIssues([line(PART_A, 2, 0, SPOOL_1), line(PART_A, 3, 0, SPOOL_2)])).toEqual([]);
  });
});

describe('missingSpoolIssues', () => {
  it('names each line without a spool, with the given message', () => {
    expect(missingSpoolIssues([line(PART_A, 1), line(PART_B, 1, 0, null)], 'Pick one.')).toEqual([
      { path: 'lines.1.filamentId', message: 'Pick one.' },
    ]);
  });
});

describe('newQueueLineIssues', () => {
  it('rejects printed pieces on a new queue', () => {
    expect(newQueueLineIssues([line(PART_A, 4, 0), line(PART_B, 4, 1)])).toEqual([
      { path: 'lines.1.completed', message: 'A new queue starts with nothing printed.' },
    ]);
  });
});

describe('lockedLineIssues', () => {
  const stored = [line(PART_A, 4, 2, SPOOL_1), line(PART_B, 3, 0, SPOOL_1)];

  it('accepts the same pair, any change to an unprinted line and a new line', () => {
    expect(
      lockedLineIssues(stored, [line(PART_A, 5, 2, SPOOL_1), line(PART_C, 1, 0, SPOOL_2)]),
    ).toEqual([]);
  });

  it('rejects a printed line that changes spool or is removed', () => {
    expect(lockedLineIssues(stored, [line(PART_A, 4, 2, SPOOL_2)])).toHaveLength(1);
    expect(lockedLineIssues(stored, [line(PART_B, 3)])).toHaveLength(1);
    expect(lockedLineIssues(stored, [])[0]).toMatchObject({ path: 'lines' });
  });

  it('accepts a split: the printed line shrinks to its completed and a second spool takes the rest', () => {
    expect(
      lockedLineIssues(stored, [line(PART_A, 2, 2, SPOOL_1), line(PART_A, 2, 0, SPOOL_2)]),
    ).toEqual([]);
  });

  it('lets a legacy printed line without a spool gain one but not leave', () => {
    const legacy = [line(PART_A, 4, 2, null)];

    expect(lockedLineIssues(legacy, [line(PART_A, 4, 2, SPOOL_2)])).toEqual([]);
    expect(lockedLineIssues(legacy, [line(PART_B, 4, 0, SPOOL_2)])).toHaveLength(1);
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
