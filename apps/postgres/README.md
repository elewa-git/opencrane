# postgres — durable PostgreSQL deployable

> [apps](../README.md) › postgres

<!-- No `@opencrane/*` import alias: this deployable is a Helm chart that wraps a vendored
     database operator. Titled by its `project.json` name (`postgres`). -->

This is a **vendored-infra deployable**: OpenCrane does not write its own database, it runs the
third-party [CloudNativePG](https://cloudnative-pg.io) (CNPG) PostgreSQL operator and wraps it in a Helm
chart we own. This app owns that wrapper — the desired database shape and its network boundary — while
CNPG owns the running database. It is the single durable data store every silo depends on.

## What it owns

A **silo** is one customer's isolated slice of OpenCrane. This chart declares the silo's database:
**one** CNPG `Cluster` holding several logical databases, expandable mounted storage, ingress
isolation, and optional plugin-based backup/recovery. Application data is retained indefinitely; the
Cluster survives Helm uninstall, and deleting a database is an explicit operator action, never a
release side-effect.

It sits beneath everything else in the silo — the server, LiteLLM, Obot, and Langfuse each get their
own logical database inside the shared Cluster, and each authenticates only to its own:

```
 ┌──────────────────────────────────────────────┐
 │  postgres (this chart)  ◄── HERE               │  declares desired Cluster + network boundary
 │   one CNPG Cluster                             │
 │     ├── opencrane   ├── litellm                │  one logical DB + owner role per authority
 │     ├── obot        └── langfuse  (+ fleet)    │
 │     └── database admin .........................│  inspect every DB; no durable writes/superuser
 └──────────────────────────────────────────────┘
        ▲ reconciled by                    ▲ connects to (own DB only)
   CloudNativePG operator (vendor)    opencrane server · litellm · obot · langfuse
```

**In this flow:** [opencrane server](../opencrane/README.md) ·
[litellm](../_infra/litellm/README.md) · [obot](../_infra/obot/README.md) ·
[langfuse](../_infra/langfuse/README.md)

CNPG bootstraps the first database from one immutable, content-addressed ConfigMap containing the
OpenCrane-owned target SQL, then declaratively reconciles the remaining least-privilege roles and
`Database` custom resources. The publisher prepends `SET ROLE` for the configured first-database
owner, so CNPG's bootstrap superuser never becomes the owner of application objects. Each application role can authenticate only to its own database —
there are no shared owner roles or credentials. A separate operational administrator can connect to
every logical database for monitoring and investigation, but cannot durably write application data,
change persistent schemas, bypass row-level security, create databases/roles, or act as a superuser.
It does receive PostgreSQL's temporary-object privilege for operational queries. Its credential is
never reused by an application. Deployment publishes a separate administrator connection Secret
for explicit operator access; no application workload consumes it. One connection Secret per
database is published by
`scripts/publish-app-connection-secret.sh`, which adds the `uri` without sharing credentials across
authorities or leaking them into command arguments or logs. Clean setup publishes the baseline with
`scripts/publish-initdb-baseline-config-map.sh`; physical recovery does not execute that SQL because
the backup already contains the schema, but records the source baseline identity as provenance.

**Invariant.** One CNPG Cluster hosts many databases (not one cluster per authority — that wastes idle
pods and volumes). Because CNPG (as the database-pod controller) generates the instance-manager
`ServiceAccount` and its narrow `Role`/`RoleBinding` — deterministically named after the Cluster and
published in the `opencrane.ai/cnpg-service-account` annotation — this chart must **not** render a
competing `ServiceAccount`, `Role`, or `RoleBinding`. The database administrator must also remain a
distinct, non-superuser operational role with its own Secret; it must never collapse into an
application owner. The app owns the desired state and boundary; the vendor controller owns the
runtime identity it reconciles.

## What OpenCrane owns vs the vendor

| OpenCrane (this chart) | CloudNativePG (vendor) |
|---|---|
| Desired `Cluster` spec, logical databases, storage request, ingress isolation | Running Postgres pods, instance-manager identity, failover |
| Supplying distinct application/admin Secret names, the app-owned target baseline reference, and database access | Bootstrapping the target SQL and reconciling roles/`Database` CRs |
| Selecting/enabling a backup plugin in values | Operator + CRD install (an external prerequisite) |

OpenCrane does **not** install or upgrade the CNPG operator, and does **not** generate, rotate, or
repair database credentials.

## Public surface

`Entrypoint:` the Helm chart under `helm/`. No importable code. Prerequisites the chart expects:

- a compatible CloudNativePG operator and CRDs, installed outside the OpenCrane release;
- one pre-created `kubernetes.io/basic-auth` Secret per logical database (`username`/`password`, where
  `username` equals that database's owner);
- one separate basic-auth Secret for the operational database administrator; its `username` must
  equal `databaseAdmin.name`, and both the username and Secret must differ from every application
  owner/Secret;
- one immutable target-baseline ConfigMap published from
  `apps/opencrane/prisma/bootstrap/target-baseline.sql` before a fresh install;
- a mounted `ReadWriteOnce` StorageClass with volume expansion enabled.

## Boundary

Storage only — it holds no application logic. It does not create shared roles, does not delete data on
uninstall, and does not manage the operator. Backup and restore stay disabled until a CNPG-I plugin and
its object-store resource are installed and explicitly selected in values.

## Dependency direction

An app entrypoint (Helm chart). It is composed by the silo umbrella chart
([`apps/_infra/deploy-k8s`](../_infra/deploy-k8s/README.md)) and imported by no package.

## Runtime & config

Install the database **before** the server release; grow the PVC request as durable data grows:

```bash
kubectl create namespace opencrane --dry-run=client -o yaml | kubectl apply -f -
BASELINE_CONFIG_MAP="$(bash apps/postgres/scripts/publish-initdb-baseline-config-map.sh \
  opencrane opencrane apps/opencrane/prisma/bootstrap/target-baseline.sql)"
helm upgrade --install opencrane-postgres apps/postgres/helm \
  --namespace opencrane \
  --set databaseAdmin.name=opencrane_database_admin \
  --set databaseAdmin.credentialsSecret=opencrane-postgres-admin \
  --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name="$BASELINE_CONFIG_MAP" \
  --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql \
  --set databases[0].credentialsSecret=opencrane-postgres-bootstrap \
  --set databases[1].credentialsSecret=opencrane-obot-postgres-bootstrap \
  --set databases[2].credentialsSecret=opencrane-litellm-postgres-bootstrap \
  --set databases[3].credentialsSecret=opencrane-langfuse-postgres-bootstrap
kubectl wait --for=condition=Ready cluster/opencrane-postgres \
  --namespace opencrane --timeout=5m
```

The chart requires exactly one target baseline for `initdb` and renders no SQL reference on
`recovery`. A recovery instead requires `restore.sourceBaselineConfigMap`, the content-addressed
identity recorded on its source Cluster, so later deploys can verify schema provenance without
executing setup again. A changed baseline does not update a running Cluster: recreate an empty database or restore a compatible
physical backup. The k3d acceptance path server-dry-runs both contracts against the pinned CNPG CRDs, installs a pinned
Barman Cloud plugin and MinIO test target, writes a marker, completes an on-demand physical backup,
recovers a fresh Cluster, and verifies the marker through the recovered application Secret.

## See also

- Parent index: [apps](../README.md)
- Consumers: [opencrane server](../opencrane/README.md) · [litellm](../_infra/litellm/README.md) ·
  [obot](../_infra/obot/README.md) · [langfuse](../_infra/langfuse/README.md)
- Silo chart that composes it: [apps/_infra/deploy-k8s](../_infra/deploy-k8s/README.md)
