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

The Job projects one application connection Secret in two forms: Prisma receives its complete URL,
including pool controls, while `psql` receives discrete libpq connection variables. Database
credentials therefore stay out of process arguments, and each client receives only the settings it
understands.

## Public surface

Entrypoint: `run-migrations.sh` accepts only tagged 0.9.2, checks the digest-bound development-candidate
repair, runs the IAM prerequisite, records the `20260826000000_0_9_2_baseline` Prisma bridge, resolves
a fully rolled-back 0.10.0 workflow-cutover attempt when a repaired image retries it, and runs
`prisma migrate deploy`. Other migration failures are returned immediately for a forward repair.

The Nx `build` contract checks that the migration image still copies and starts this entrypoint with
the reviewed Prisma ledger. `lint` checks every app-owned shell entrypoint and contract before CI
selects the independently publishable `container` target.

## Boundary

The PostgreSQL chart chooses when this image runs. This app does not decide which database it is
allowed to change and does not run as part of the OpenCrane server image.

## Dependency direction

This is an `entrypoint` app with `scope:opencrane`. It builds the OpenCrane migration inputs but does
not import another app at runtime.

## Runtime & config

The Job supplies `DATABASE_URL`, the discrete libpq connection variables, and
`OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.2`, `OPENCRANE_MIGRATION_SILO_ID`, and
`OPENCRANE_MIGRATION_OIDC_ISSUER`. Fresh databases use the reviewed target baseline instead and do
not run this upgrade image.

The `0.9.3` candidate was never tagged. The migrator recognizes only the exact reviewed candidate
ledger, derives its invitation-audit silo from existing product records, applies the missing MCP
database authority, and records a distinct forward-repair receipt. It preserves the candidate rows
as historical evidence instead of relabelling them as a release. Any other candidate shape fails
closed and still requires its own reviewed repair or a development reset.

## See also

- Parent map: [apps](../README.md)
- Database Job: [postgres](../postgres/README.md)
- Migration folders: [opencrane Prisma migrations](../opencrane/prisma/prisma-migrations/README.md)
