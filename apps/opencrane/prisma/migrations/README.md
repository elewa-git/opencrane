# Version-to-version database migrations

The current clean target baseline remains in `../bootstrap/target-baseline.sql`. This directory keeps
the SQL transitions authored before 0.10.0. Tagged release history remains unchanged. The dedicated
0.9.2-to-0.10.0 Job executes `0.9.0-to-0.10.0-prerequisite` once because tagged 0.9.2 still records
database schema 0.9.0; other entries are evidence only.

Each transition has one exact `<from>-to-<to>/` directory containing:

- `migration.sql` — transactional SQL that acquires the migration advisory lock and advances schema
  history only after success;
- `manifest.json` — exact `fromSchemaVersion`/`toSchemaVersion`, `sqlSha256`, owner
  `apps/opencrane`, and any required privileged PostgreSQL extension.

After that prerequisite, [`../prisma-migrations`](../prisma-migrations/README.md) is the only upgrade ledger.
Migration backup, schema checks, and write pauses remain deferred hardening work tracked in issue
#699.

The untagged `0.9.3` candidate is not a release boundary. Development databases that already ran its
candidate migration require a reset or explicitly reviewed forward repair.
