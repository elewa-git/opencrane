# postgres — durable PostgreSQL deployable

> [apps](../README.md) › postgres

OpenCrane runs CloudNativePG (CNPG), a Kubernetes operator that manages PostgreSQL. This package owns
the OpenCrane Helm chart around CNPG: the database layout, the connection pool, and access
boundaries. CNPG owns the database process itself.

## What it owns

A **silo** is one customer's isolated OpenCrane installation. This chart creates one PostgreSQL
Cluster for that silo, with separate logical databases and credentials for the OpenCrane server,
LiteLLM, and Obot. It also creates a PgBouncer connection pool and database privilege Jobs.

```
  application release
          │ target baseline SQL
          ▼
  ┌───────────────────────────────┐
  │ postgres chart  ◄── HERE       │
  │ Cluster · pooler · privileges  │
  └───────────────────────────────┘
          │ connection Secrets
          ▼
  server · LiteLLM · Obot
```

**In this flow:** [OpenCrane server](../opencrane/README.md) ·
[LiteLLM](../_infra/litellm/README.md) · [Obot](../_infra/obot/README.md)

The schema is created once, by CNPG `initdb` from the app-owned target baseline (the baseline
publisher prepends the `pg_cron` prerequisite). There is no version-to-version migration Job
pre-1.0: a dev silo that needs a newer schema is rebuilt, and upgrade contracts return at MVP
(see [`docs/agents/versioning.md`](../../docs/agents/versioning.md)).

## Public surface

Entrypoint: `apps/postgres/helm` is the PostgreSQL Helm chart.

- `scripts/publish-initdb-baseline-config-map.sh` publishes the SQL for a new database.
- `scripts/publish-app-connection-secret.sh` publishes each application's own connection Secret.

## Boundary

The chart creates and manages PostgreSQL resources only. Application code must not migrate its own
schema at startup. Operational backup and restore remain optional chart features; they are not a
condition for deployment.

## Dependency direction

This deployable has `scope:postgres`. It is an application boundary and does not provide a general
database library for product code.

## Runtime and config

The deploy wrapper supplies the PostgreSQL image, database-owner credential Secrets, the target
baseline ConfigMap, and Kubernetes API addresses for network policy.
Use `apps/_infra/deploy-k8s/deploy.sh` rather than calling the chart directly for a normal install or
upgrade.

## See also

- Parent index: [apps](../README.md)
- Deployment tools: [deploy-k8s platform](../_infra/deploy-k8s/platform/README.md)
- Baseline source: [OpenCrane server](../opencrane/README.md) (`prisma/bootstrap/target-baseline.sql`)
