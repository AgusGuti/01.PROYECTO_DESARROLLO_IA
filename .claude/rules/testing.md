---
paths:
  - '**/*.spec.ts'
  - 'apps/assistant/tests/**'
  - 'e2e/**'
---

# Testing rules

Standard §10.

## Which test, where

| Kind        | File                                          | Runs against                         | Command                                |
| ----------- | --------------------------------------------- | ------------------------------------ | -------------------------------------- |
| Unit        | `*.spec.ts` beside the code                   | pure functions, services with fakes  | `npm run test:api`, `npm run test:web` |
| API         | `*.spec.ts` using `createTestApp` + supertest | the real Express app, database faked | `npm run test:api`                     |
| Integration | `*.int.spec.ts`                               | real MongoDB replica set in memory   | `npm run test:int`                     |
| Assistant   | `apps/assistant/tests/test_*.py`              | FastAPI app, model faked             | `npm run py:test`                      |
| End to end  | `e2e/*.spec.ts`                               | browser → Angular → API → MongoDB    | `npm run test:e2e`                     |

Repositories and anything relying on an index, a unique constraint, an atomic update or a
transaction **must** have an integration test. A mocked database proves nothing about those.

## What every use case covers (§10.2)

Success · invalid input and boundary values · missing resource · conflict (duplicate, stale
version, concurrent update) where data is written · a dependency failing · pagination limits ·
no sensitive or internal field in the response.

When authentication exists, add: no credentials, and valid credentials without permission.

## Quality

- Deterministic: inject the clock and randomness; no real network, no dependence on test order,
  no shared mutable state. Each test builds the data it needs.
- Assert behaviour, not implementation. A test that only repeats the mocks it set up is noise.
- One reason to fail per test. Name it as a sentence stating the expected behaviour.
- Arrange, act, assert, separated by blank lines.
- Small explicit fixtures. No large snapshots.
- A bug fix starts with a test that fails for the right reason.

## Never

- `.only`, `.skip`, `xit`, `@pytest.mark.skip`, or deleting a failing test to get green.
- Raising a timeout or adding a retry to hide flakiness. Find the cause, or report it.
- Claiming a test passed without running it. Quote the real summary line.
- Treating a coverage number as proof. Coverage finds untested code; it does not show that the
  assertions mean anything.
