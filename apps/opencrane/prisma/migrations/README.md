# Version-to-version database migrations

The current clean target baseline remains in `../bootstrap/target-baseline.sql`. This directory is
the upgrade authority for databases created by an earlier repository train.

Each transition has one exact `<from>-to-<to>/` directory containing:

- `migration.sql` — transactional SQL that acquires the migration advisory lock and advances schema
  history only after success;
- `manifest.json` — exact `fromSchemaVersion`/`toSchemaVersion`, `sqlSha256`, owner
  `apps/opencrane`, and any required privileged PostgreSQL extension.

Migrations do not retain old schemas, aliases, or dual-write behavior. A failed migration is repaired
forward; migration backup, schema checks, write pauses, and automatic recovery are deferred hardening
work tracked in issue #699.

The migration Job verifies the reviewed SQL bytes before it runs.
