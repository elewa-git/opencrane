# Prisma Migrate ledger

> [OpenCrane server](../../README.md) › [database migrations](../migrations/README.md) › Prisma Migrate ledger

## What it owns

This directory is the only database-change ledger used from OpenCrane 0.10.0 onward. The first
migration records the already released 0.9.3 database as the starting point. The next migration
moves that database forward to 0.10.0. It does not change the older migration files or release
history.

```text
0.9.3 database
      │ no-op baseline entry
      ▼
Prisma migration ledger  ◄── HERE
      │ forward 0.10.0 SQL
      ▼
0.10.0 database
```

**In this flow:** the [dedicated migration image](../../../opencrane-prisma-migrator/README.md) runs
`prisma migrate deploy` before the upgraded OpenCrane server starts.

## Public surface

- `migration_lock.toml` fixes PostgreSQL as the database provider.
- `20260826000000_0_9_3_baseline` records the released starting point without replaying old SQL.
- `20260827000000_0_10_0_workflow_cutover` applies the forward workflow and OCI cutover.

## Boundary

New databases still use the reviewed target baseline. Existing 0.9.3 databases use this ledger.
The OpenCrane server never runs migrations during startup.

## Dependency direction

Only the OpenCrane-owned migration image and the PostgreSQL migration Job consume these files.

## See also

- [Historical version migrations](../migrations/README.md)
- [Target baseline](../bootstrap/README.md)
