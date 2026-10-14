---
name: request-exception
description: Drafts a written exception to a mandatory rule of the engineering standard for the user to accept or reject. Use only after pushing back, when the user still wants to deviate from a MUST rule, or when a guard blocks something the user has decided to do anyway.
---

# Request an exception

Standard §0.2: an exception to a mandatory requirement must be documented and justified, and one
involving risk must be accepted by the responsible person. Here that person is Agustín. An agent
drafts; only he accepts.

## Before drafting

You must already have applied the pushback protocol: named the rule, explained the consequence,
and offered the compliant alternative. If you have not, do that now instead.

Ask yourself whether an exception is really needed. Most blocked edits have a compliant form:
narrow a type instead of `any`, parse instead of casting, fix the test instead of skipping it.

## Draft

1. Find the next number: list `docs/exceptions/` and add one to the highest `EXC-NNNN`.
2. Write `docs/exceptions/EXC-NNNN-short-kebab-title.md` from the template below.
3. Set `Status: proposed`. **Never write `accepted`.** The write prompts Agustín; that is the
   design, not an obstacle.
4. Tell him, in a few lines: what the exception permits, the risk in plain words, the condition
   under which it ends, and that he accepts by changing the status line himself.
5. Stop. Do not apply the deviating change until the file says `Status: accepted`.

## Template

```markdown
# EXC-NNNN: <short title>

- **Status:** proposed
- **Date:** YYYY-MM-DD
- **Requested by:** Agustín Gutiérrez
- **Accepted by:** (Agustín fills this in when accepting)
- **Rule:** <quote the MUST and cite the section, e.g. §8.1>
- **Scope:** <exact files, lines, modules or environments; as narrow as possible>
- **Expires:** <a date or a roadmap event; never "indefinitely">

## Why the rule cannot be followed here

<the concrete constraint, not a preference>

## Risk

<what can go wrong, how likely, how bad; written for someone new to the stack>

## Compensating controls

<what limits the damage while the exception is in force, and how it is tested>

## How to remove it

<the work that makes the code compliant again>
```

## After acceptance

- A suppression must cite the id on the same line: `// eslint-disable-next-line <rule> -- EXC-NNNN <reason>`.
  The guards and `npm run guard:scan` waive only lines that cite an accepted record.
- Some rules can never be waived this way (`@ts-ignore`, `$where`, `eval`, disabling TLS
  verification, a MongoDB driver in the assistant). Say so and return to the compliant design.
- If the exception relaxes a gate's configuration, change only what the scope names.
- Mention open exceptions in the pull request, and remove the record's effect when it expires.
