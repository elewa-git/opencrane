# opencrane-prisma-migrator — database change runner

> [OpenCrane](../../README.md) › [apps](../README.md) › opencrane-prisma-migrator

## What it owns

This deployable provides the one-off container that applies the saved OpenCrane database changes.
A database migration is a small, ordered database change. It runs before the OpenCrane server
starts, so server startup never changes tables by itself.

```
 released 0.9.3 database
                    │
                    ▼
  postgres chart ── creates the bounded migration Job
                    │
                    ▼
 ┌──────────────────────────────────────┐
 │ opencrane-prisma-migrator ◄── HERE    │
 │ records and applies Prisma migrations │
 └──────────────────────────────────────┘
                    │
                    ▼
             OpenCrane server starts
```

**In this flow:** [postgres](../postgres/README.md) supplies the Job and database connection;
[opencrane](../opencrane/README.md) uses the resulting schema.

The image contains Prisma and the versioned migration folders from the same source build. It has no
HTTP server, Kubernetes permissions, or product request handling. The Job receives the application
database URL and the admitted source release, then records the known 0.9.3 starting point before
applying later changes.

## Public surface

Entrypoint: `run-migrations.sh` records the released 0.9.3 baseline and runs `prisma migrate deploy`.
A failed migration is returned immediately for a forward code or migration repair.

## Boundary

The PostgreSQL chart chooses when this image runs. This app does not decide which database it is
allowed to change and does not run as part of the OpenCrane server image.

## Dependency direction

This is an `entrypoint` app with `scope:opencrane`. It builds the OpenCrane migration inputs but does
not import another app at runtime.

## Runtime & config

The Job supplies `DATABASE_URL` and `OPENCRANE_MIGRATION_SOURCE_VERSION=0.9.3`. Fresh databases use
the reviewed target baseline instead and do not run this upgrade image.

## See also

- Parent map: [apps](../README.md)
- Database Job: [postgres](../postgres/README.md)
- Migration folders: [opencrane Prisma migrations](../opencrane/prisma/prisma-migrations/README.md)
