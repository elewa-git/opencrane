# Version-to-version database migrations

The current clean target baseline remains in `../bootstrap/target-baseline.sql`. This directory is
the upgrade authority for databases created by an earlier repository train.

Each transition has one exact `<from>-to-<to>/` directory containing:

- `migration.sql` — transactional, fail-closed SQL that checks the exact source schema version,
  acquires the migration advisory lock, and advances schema history only after success;
- `manifest.json` — exact `fromSchemaVersion`/`toSchemaVersion`, `sqlSha256`, owner
  `apps/opencrane`, and rollback mode `backup-restore-or-forward-repair`.

Automatic generation is limited to adjacent minor trains such as `0.7.x` to `0.8.0`. Patch, major,
skipped, and reverse transitions require an explicit manual release plan. Migrations do not retain
old schemas, aliases, or dual-write behavior. Rollback is backup/restore or reviewed forward repair.

Every transition must prove equivalence between a previous-version database upgraded through this
path and a fresh database created from the new target baseline, including authority functions,
triggers, constraints, indexes, and seeds.
