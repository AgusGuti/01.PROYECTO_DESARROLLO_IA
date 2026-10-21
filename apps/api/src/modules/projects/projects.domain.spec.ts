import { describe, expect, it } from 'vitest';
import {
  duplicatedItemIssues,
  missingFilamentIssues,
  missingPartIssues,
  PRIORITIES,
  summarise,
} from './projects.domain.js';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const S1 = '1'.repeat(24);
const S2 = '2'.repeat(24);

describe('PRIORITIES', () => {
  it('goes from the least to the most urgent, because the order is the meaning', () => {
    expect([...PRIORITIES]).toEqual(['low', 'normal', 'high', 'urgent']);
  });
});

describe('duplicatedItemIssues', () => {
  it('finds nothing in a list without repeats or in an empty list', () => {
    expect(duplicatedItemIssues([])).toEqual([]);
    expect(
      duplicatedItemIssues([
        { partId: A, filamentId: S1, quantity: 1 },
        { partId: B, filamentId: S1, quantity: 1 },
      ]),
    ).toEqual([]);
  });

  it('puts the issue on the second occurrence, not the first', () => {
    const issues = duplicatedItemIssues([
      { partId: A, filamentId: S1, quantity: 1 },
      { partId: B, filamentId: S1, quantity: 1 },
      { partId: A, filamentId: S1, quantity: 5 },
    ]);

    expect(issues).toEqual([{ path: 'items.2.filamentId', message: 'Duplicated part and spool.' }]);
  });

  it('reports every later occurrence of a part that appears three times', () => {
    const issues = duplicatedItemIssues([
      { partId: A, filamentId: S1, quantity: 1 },
      { partId: A, filamentId: S1, quantity: 1 },
      { partId: A, filamentId: S1, quantity: 1 },
    ]);

    expect(issues.map((issue) => issue.path)).toEqual(['items.1.filamentId', 'items.2.filamentId']);
  });
});

describe('duplicatedItemIssues with spools', () => {
  it('allows the same part on several lines with different spools', () => {
    expect(
      duplicatedItemIssues([
        { partId: A, filamentId: S1, quantity: 1 },
        { partId: A, filamentId: S2, quantity: 1 },
        { partId: B, filamentId: S1, quantity: 1 },
      ]),
    ).toEqual([]);
  });

  it('flags only the repeated pair, by index, when the part repeats with other spools between', () => {
    const issues = duplicatedItemIssues([
      { partId: A, filamentId: S1, quantity: 1 },
      { partId: A, filamentId: S2, quantity: 1 },
      { partId: A, filamentId: S1, quantity: 3 },
    ]);

    expect(issues).toEqual([{ path: 'items.2.filamentId', message: 'Duplicated part and spool.' }]);
  });
});

describe('missingFilamentIssues', () => {
  it('flags only the lines whose spool is not live and skips a legacy null spool', () => {
    const issues = missingFilamentIssues(
      [
        { partId: A, filamentId: S1, quantity: 1 },
        { partId: A, filamentId: S2, quantity: 1 },
        { partId: B, filamentId: null, quantity: 1 },
      ],
      new Set([S1]),
    );

    expect(issues).toEqual([{ path: 'items.1.filamentId', message: 'The spool does not exist.' }]);
  });
});

describe('missingPartIssues', () => {
  it('flags only the lines whose part is not live, with one text for every cause', () => {
    const issues = missingPartIssues(
      [
        { partId: A, filamentId: S1, quantity: 1 },
        { partId: B, filamentId: S1, quantity: 1 },
      ],
      new Set([A]),
    );

    expect(issues).toEqual([{ path: 'items.1.partId', message: 'The part does not exist.' }]);
  });
});

describe('summarise', () => {
  it('counts the lines and adds up the units', () => {
    expect(
      summarise([
        { partId: A, filamentId: S1, quantity: 6 },
        { partId: B, filamentId: S1, quantity: 2 },
      ]),
    ).toEqual({ itemCount: 2, unitCount: 8 });
  });

  it('is zero for a project without lines', () => {
    expect(summarise([])).toEqual({ itemCount: 0, unitCount: 0 });
  });
});
