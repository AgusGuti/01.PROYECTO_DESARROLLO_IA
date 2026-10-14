# Runbook: database indexes

MongoDB enforces rules that the application relies on, such as "two printers cannot share a
name" (ADR 0006). Deleted and archived printers keep their name reserved too, so the rule covers
every document. That rule is the **unique index** `printers_name_unique` (case-insensitive, no
partial filter). A database created earlier may still hold the old `printers_name_live_unique`
index; it is harmless because the new one is stricter, and it is only dropped by hand, never
automatically. In production Mongoose does not create
indexes by itself (`autoIndex` is off), and schema changes are never applied automatically when
the API starts. So an index is created deliberately, with one command.

## When to run it

- On every deploy, **before** starting the new API version.
- After restoring a database from a backup into an empty server.
- Never needed in development and tests: Mongoose creates the indexes there.

## How

From the repository root, with the production `.env` loaded:

```text
npm run db:indexes
```

It connects, creates every index the code declares and exits. Running it again changes nothing.
It ends with `database indexes are in place` or with a fatal log and a non-zero exit code.

## If the API refuses to start

In production the API checks at startup that the unique name index exists. Without it the log
says `database indexes are missing; run: npm run db:indexes`. Run the command above and start
the API again. This is intentional: starting without the index would let duplicate names in.

## If the command fails

- **Cannot connect:** check `MONGODB_URI` and that MongoDB is running (`npm run doctor`).
- **Duplicate key while building the index:** the collection already holds two printers (deleted
  ones included) with the same name (ignoring case). Index creation never deletes data. Decide with Agustín which one
  to rename, rename it, then run the command again.

## Adding an index later

Declare it in the module's repository, call its creation from `scripts/ensure-indexes.ts`, add a
test that it exists, and mention it here. Remember that every index slows writes (standard §4.5).
