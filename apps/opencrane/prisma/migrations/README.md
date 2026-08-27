# Version-to-version database migrations

The current clean target baseline remains in `../bootstrap/target-baseline.sql`. This directory keeps
the released SQL transitions used before 0.10.0. They remain unchanged as release history, but the
deployment path no longer executes them.

Each transition has one exact `<from>-to-<to>/` directory containing:

- `migration.sql` — transactional SQL that acquires the migration advisory lock and advances schema
  history only after success;
- `manifest.json` — exact `fromSchemaVersion`/`toSchemaVersion`, `sqlSha256`, owner
  `apps/opencrane`, and any required privileged PostgreSQL extension.

From 0.10.0 onward, [`../prisma-migrations`](../prisma-migrations/README.md) is the only upgrade ledger.
Migration backup, schema checks, and write pauses remain deferred hardening work tracked in issue
#699.

These historical files are evidence only.
