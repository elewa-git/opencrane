# Prisma Migrate ledger

> [OpenCrane server](../../README.md) › [database migrations](../migrations/README.md) › Prisma Migrate ledger

## What it owns

This directory is the only database-change ledger used from OpenCrane 0.10.0 onward. The dedicated
migration Job first carries tagged 0.9.2's 0.9.0 schema through the reviewed IAM prerequisite. The
first Prisma entry records that prepared schema. The remaining ordered entries install the workflow
cutover and central product authorization. The workflow cutover removes the replaced SQL workload
plane in the same transaction that installs its successor.

```text
0.9.2 database (schema 0.9.0)
      │ reviewed IAM prerequisite
      ▼
prepared schema
      │ no-op Prisma bridge
      ▼
Prisma migration ledger  ◄── HERE
      │ workflow and OCI cutover, including SQL workload retirement
      ▼
central authorization authority
      │ install transaction-bound product authorization
      ▼
0.10.0 database
```

**In this flow:** the [dedicated migration image](../../../opencrane-prisma-migrator/README.md) runs
`prisma migrate deploy` before the upgraded OpenCrane server starts.

## Public surface

- `migration_lock.toml` fixes PostgreSQL as the database provider.
- `20260826000000_0_9_2_baseline` records the prepared tagged-release starting point without
  replaying pre-0.10 SQL.
- `20260827000000_0_10_0_workflow_cutover` applies the forward workflow and OCI cutover.
- `20260829000000_central_authorization_authority` removes the replaced receipt and generic memory
  queues, then installs transaction-bound product authorization and ToolInvocation evidence.

Only timestamped migration directories belong here. Contract tests live outside this directory so
Prisma does not mistake them for migrations.

## Boundary

New databases still use the reviewed target baseline. Existing 0.9.2 databases use the prerequisite
and all three ordered entries in this ledger. An untagged candidate database must follow the
checksum-bound forward repair or be reset; it is not a supported release predecessor.
The OpenCrane server never runs migrations during startup.

## Dependency direction

Only the OpenCrane-owned migration image and the PostgreSQL migration Job consume these files.

## See also

- [Historical version migrations](../migrations/README.md)
- [Target baseline](../bootstrap/README.md)
