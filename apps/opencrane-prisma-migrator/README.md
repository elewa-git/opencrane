# opencrane-prisma-migrator — database change runner

> [OpenCrane](../../README.md) › [apps](../README.md) › opencrane-prisma-migrator

## What it owns

This deployable provides the one-off container that applies the saved OpenCrane database changes.
A database migration is a small, ordered database change. It runs before the OpenCrane server
starts, so server startup never changes tables by itself.

```
 tagged 0.9.2 database (schema 0.9.0)
                    │
                    ▼
  postgres chart ── creates the bounded migration Job
                    │
                    ▼
 ┌──────────────────────────────────────┐
 │ opencrane-prisma-migrator ◄── HERE    │
 │ IAM prerequisite, then Prisma ledger  │
 └──────────────────────────────────────┘
                    │
                    ▼
             OpenCrane server starts
```

**In this flow:** [postgres](../postgres/README.md) supplies the Job and database connection;
[opencrane](../opencrane/README.md) uses the resulting schema.

The image contains Prisma and the versioned migration folders from the same source build. It has no
HTTP server, Kubernetes permissions, or product request handling. The Job receives the application
database URL, admitted source release, exact silo, and OIDC issuer. It applies the reviewed IAM
prerequisite before recording the Prisma bridge and applying later changes.

## Public surface

Entrypoint: `run-migrations.sh` accepts only tagged 0.9.2, runs the digest-bound IAM prerequisite,
records the `20260826000000_0_9_2_baseline` Prisma bridge, resolves a fully rolled-back 0.10.0
workflow-cutover attempt when a repaired image retries it, and runs `prisma migrate deploy`. Other
migration failures are returned immediately for a forward code or migration repair.

## Boundary

The PostgreSQL chart chooses when this image runs. This app does not decide which database it is
allowed to change and does not run as part of the OpenCrane server image.

## Dependency direction

This is an `entrypoint` app with `scope:opencrane`. It builds the OpenCrane migration inputs but does
not import another app at runtime.

## Runtime & config

The Job supplies `DATABASE_URL`, `OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2`,
`OPENCRANE_MIGRATION_SILO_ID`, and `OPENCRANE_MIGRATION_OIDC_ISSUER`. Fresh databases use the
reviewed target baseline instead and do not run this upgrade image.

The `0.9.3` candidate was never tagged. A development database that already recorded its old
candidate migration IDs must be reset or receive an explicitly reviewed forward repair; this image
will not relabel it as the supported path.

## See also

- Parent map: [apps](../README.md)
- Database Job: [postgres](../postgres/README.md)
- Migration folders: [opencrane Prisma migrations](../opencrane/prisma/prisma-migrations/README.md)
