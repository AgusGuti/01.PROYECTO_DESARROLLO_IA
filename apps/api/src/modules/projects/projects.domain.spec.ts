import { describe, expect, it } from 'vitest';
import {
  duplicatedItemIssues,
  missingPartIssues,
  PRIORITIES,
  summarise,
} from './projects.domain.js';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

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
        { partId: A, quantity: 1 },
        { partId: B, quantity: 1 },
      ]),
    ).toEqual([]);
  });

  it('puts the issue on the second occurrence, not the first', () => {
    const issues = duplicatedItemIssues([
      { partId: A, quantity: 1 },
      { partId: B, quantity: 1 },
      { partId: A, quantity: 5 },
    ]);

    expect(issues).toEqual([{ path: 'items.2.partId', message: 'Duplicated part.' }]);
  });

  it('reports every later occurrence of a part that appears three times', () => {
    const issues = duplicatedItemIssues([
      { partId: A, quantity: 1 },
      { partId: A, quantity: 1 },
      { partId: A, quantity: 1 },
    ]);

    expect(issues.map((issue) => issue.path)).toEqual(['items.1.partId', 'items.2.partId']);
  });
});

describe('missingPartIssues', () => {
  it('flags only the lines whose part is not live, with one text for every cause', () => {
    const issues = missingPartIssues(
      [
        { partId: A, quantity: 1 },
        { partId: B, quantity: 1 },
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
        { partId: A, quantity: 6 },
        { partId: B, quantity: 2 },
      ]),
    ).toEqual({ itemCount: 2, unitCount: 8 });
  });

  it('is zero for a project without lines', () => {
    expect(summarise([])).toEqual({ itemCount: 0, unitCount: 0 });
  });
});
