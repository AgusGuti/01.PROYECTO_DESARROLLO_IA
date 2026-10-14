---
name: mongo-model
description: Walks through the data-modelling decisions for a MongoDB collection before any schema is written. Use when adding a collection, changing a document's shape, adding an index, or deciding between embedding and referencing.
---

# MongoDB model checklist

Standard §4. Answer every question in writing before creating or changing a Mongoose schema.
The answers go into the ADR for the feature (use the `adr` skill) or a comment block at the top
of the repository file. Agustín knows MongoDB: be precise rather than introductory.

## 1. Access patterns

- Which queries read this data? For each: filter fields, sort, expected result size, frequency.
- Which writes change it? For each: which fields, how often, can two happen at once?
- How large can one document get, and how many documents in a year of use?

## 2. Shape

For each relationship choose and justify:

| Embed when                          | Reference when             |
| ----------------------------------- | -------------------------- |
| read together with the parent       | read or updated on its own |
| bounded and small                   | can grow without limit     |
| owned by the parent, same lifecycle | shared by several parents  |

Then: is anything here a **snapshot** that must not change when its source changes (a confirmed
schedule, a quoted cost)? Is anything **derived** and stored anyway? If so, who keeps it
consistent, and is there a test for that?

## 3. Fields

- Units in the name: `weightGrams`, `durationSeconds`, `costCents`. Integers for anything summed.
- Instants as UTC `Date`. Enumerations as string literals with a default.
- `createdAt`, `updatedAt` (Mongoose `timestamps`) and a `version` number for optimistic locking
  on anything a user edits.

## 4. Invariants

List each rule and where it is enforced:

| Invariant                   | Domain rule | Schema validator | Index  | Test                  |
| --------------------------- | ----------- | ---------------- | ------ | --------------------- |
| e.g. filament remaining ≥ 0 | yes         | `min: 0`         | –      | atomic decrement test |
| e.g. printer name unique    | –           | –                | unique | double-insert test    |

Uniqueness always needs the index column filled in.

## 5. Indexes

One row per index: fields and order, the query it serves, unique or not. Do not add an index
without a query; do not leave a frequent query without one. Confirm with
`explain('executionStats')` once data exists.

## 6. Concurrency

For each write that depends on current state: what happens if two run together? Choose a
conditional atomic update, optimistic versioning, or a transaction, and say why the cheaper
options are not enough before picking a transaction.

## 7. Deletion

Hard delete, soft delete, or refused while referenced? What happens to documents that point
here? Is there data to retain or anonymise?

## 8. Change

Can the existing application read documents written in the new shape, and the reverse? If not,
plan expand → migrate → contract and write the rollback.

## Output

Hand the completed checklist to the `data-mongodb` agent, or implement following
`.claude/rules/data.md`. Each invariant row becomes at least one test.
