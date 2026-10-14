---
name: verify
description: Runs the project's quality gates and reports the real results. Use before saying work is done, before opening or updating a pull request, when the user asks whether something works or passes, and after fixing a failing gate.
---

# Verify

Standard §10.4 and §16. The rule this skill exists for: **never report a result you did not
observe in this session.**

## Run

| When                            | Command                | Covers                                                                                                          |
| ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| After a change, before stopping | `npm run verify:quick` | guard rules, formatting, lint, API types, architecture, contract freshness, API unit tests, Python gates        |
| Before a pull request           | `npm run verify`       | all of the above plus web types, integration tests, web tests, production builds, dependency audit, secret scan |
| A critical user flow changed    | `npm run test:e2e`     | browser → Angular → API → MongoDB (needs `npm run db:up`)                                                       |

If the environment itself looks broken, run `npm run doctor` first.

## When a gate fails

1. Read the actual error. Reproduce it with the single command shown in the summary line.
2. Fix the **cause in the code**.
3. Do not make it pass by: editing the rule or its configuration, adding a suppression, skipping
   or deleting a test, loosening a type, raising a timeout, or `--force`.
4. If you believe the gate itself is wrong, stop and say so. Changing a gate needs Agustín's
   approval and, for a rule from the standard, the `request-exception` skill.
5. Re-run the whole command, not only the gate you fixed.

## Report

Paste the summary table that `verify` prints, unedited. Then state:

- which command you ran (`verify:quick` is **not** `verify`; say which);
- anything marked `SKIP`, which means **not verified**;
- anything you could not run and why;
- for a pull request: which items of the §16 checklist apply and how each was checked.

Use plain statements. "All gates passed" only if that is the last line of the summary.
"Quick gates passed; integration tests, web tests and build were not run" is a correct report.
