# postgres — durable PostgreSQL deployable

> [apps](../README.md) › postgres

OpenCrane runs CloudNativePG (CNPG), a Kubernetes operator that manages PostgreSQL. This package owns
the OpenCrane Helm chart around CNPG: the database layout, the connection pool, access boundaries,
and the one-off migration Job. CNPG owns the database process itself.

## What it owns

A **silo** is one customer's isolated OpenCrane installation. This chart creates one PostgreSQL
Cluster for that silo, with separate logical databases and credentials for the OpenCrane server
and LiteLLM. It also creates a PgBouncer connection pool and database privilege Jobs.

```
  application release
          │ immutable Prisma migration image, for an upgrade
          ▼
  ┌───────────────────────────────┐
  │ postgres chart  ◄── HERE       │
  │ Cluster · pooler · migration   │
  └───────────────────────────────┘
          │ connection Secrets
          ▼
  server · LiteLLM
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[LiteLLM](../_infra/litellm/README.md)

For the 0.9.3-to-0.10.0 upgrade, the deployer publishes the pooled OpenCrane database connection and
runs the bounded Prisma migration Job. Prisma Migrate is the only ordered record of upgrade changes.
A failure is returned directly. Deployment does not require a migration backup, inspect the existing
schema, pause application writes, or restore an earlier application release. Issue #699 tracks that
deferred hardening work.

The migration Job is not a general database shell. It has no Kubernetes API permission, runs with a
read-only root filesystem, and can reach only the release-local connection pool and Domain Name
System (DNS). A migration failure is returned directly for a forward repair.

## Public surface

Entrypoint: `apps/postgres/helm` is the PostgreSQL Helm chart.

- `scripts/publish-initdb-baseline-config-map.sh` publishes the SQL for a new database.
- `scripts/publish-app-connection-secret.sh` publishes each application's own connection Secret.

## Boundary

The chart creates and manages PostgreSQL resources only. Application code must not migrate its own
schema at startup. Operational backup and restore remain optional chart features; they are not a
condition for migration deployment.

## Dependency direction

This deployable has `scope:postgres`. It is an application boundary and does not provide a general
database library for product code.

## Runtime and config

The deploy wrapper supplies the PostgreSQL image, database-owner credential Secrets, the target
baseline ConfigMap, Kubernetes API addresses for network policy, and any reviewed migration image.
Use `apps/_infra/deploy-k8s/deploy.sh` rather than calling the chart directly for a normal install or
upgrade.

## See also

- Parent index: [apps](../README.md)
- Deployment tools: [deploy-k8s platform](../_infra/deploy-k8s/platform/README.md)
- Migration source: [OpenCrane Prisma ledger](../opencrane/prisma/prisma-migrations/README.md)
