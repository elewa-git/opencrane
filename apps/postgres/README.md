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
**one** CNPG `Cluster` holding several logical databases, a bounded CNPG-managed PgBouncer pooler,
expandable mounted storage, ingress isolation, and optional plugin-based backup/recovery. Application
data is retained indefinitely; the Cluster survives Helm uninstall, and deleting a database is an
explicit operator action, never a release side-effect.

It sits beneath everything else in the silo — the server, LiteLLM, and Obot each get their
own logical database inside the shared Cluster, and each authenticates only to its own:

```
 ┌──────────────────────────────────────────────┐
 │  postgres (this chart)  ◄── HERE               │  declares desired Cluster + network boundary
 │   one CNPG Cluster + bounded PgBouncer Pooler  │
 │     ├── opencrane   ├── litellm                │  one logical DB + owner role per authority
 │     └── obot                                    │
 │     └── database admin .........................│  inspect every DB; no durable writes/superuser
 └──────────────────────────────────────────────┘
        ▲ reconciled by                    ▲ connects to (own DB only)
   CloudNativePG operator (vendor)    opencrane server · litellm · obot
```

**In this flow:** [opencrane server](../opencrane/README.md) ·
[litellm](../_infra/litellm/README.md) · [obot](../_infra/obot/README.md)

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
the backup already contains the schema and its protected, superuser-owned baseline marker. The
privileges hook verifies that in-database marker before application deployment can continue.
It retries transient CNPG rollout disconnects within a fixed shell budget, applies each privilege
batch in one transaction, and leaves a short Job-deadline grace period for the final PostgreSQL
diagnostic. A persistent failure still blocks the Helm hook.

The durable-task foundation requires PostgreSQL's `pg_cron` extension in the `opencrane` database.
The repository builds a candidate PostgreSQL operand from the exact CloudNativePG 17.5 image and adds
only the checksum-pinned PGDG `postgresql-17-cron` package. The image smoke proves the extension
control file and shared library exist before publication. The release manifest binds the published
operand with both its PostgreSQL-version-prefixed qualified tag and immutable digest, which lets
CloudNativePG detect an operand upgrade without permitting mutable tag drift. The deployment engine
passes that reference to this chart. Building the image alone does not
change the running database operand.
This chart pins `shared_preload_libraries=pg_cron` and `cron.database_name=opencrane`. On an existing
database upgrade, the deployment engine fences the server, reconciles that CNPG configuration, then
proves the ready primary exposes the extension package and database setting before it publishes the
digest-bound migration. Only that fenced migration may briefly enable CNPG's generated `postgres`
credential to run the fixed `CREATE EXTENSION IF NOT EXISTS pg_cron` statement. The engine immediately
disables that access, proves both its Cluster setting and generated Secret are absent, then proves the
installed extension before it reconciles application privileges. A fresh install receives the extension
through the same reviewed baseline.

The pooler is deliberately part of the data boundary rather than an optional optimisation. Its default
budget permits at most ten server connections per logical database (thirty across the deployed
databases) while PostgreSQL permits eighty. The OpenCrane server's one replica is further capped at
five Prisma connections with a five-second acquisition timeout. That means a burst waits at PgBouncer
instead of holding every PostgreSQL connection while a run-admission transaction waits on a service
lock. If replica counts or database count change, change these numbers together and keep the summed
pooler budget below `postgresql.maxConnections`. The pooler and the one-shot privilege containers
also declare small CPU and memory requests explicitly. This prevents managed Kubernetes platforms
from replacing an omitted request with a much larger provider default; raise those requests only from
observed utilisation. The portable chart leaves the proof Job's node selector empty. The GKE
Autopilot profile selects the bootstrap-owned `opencrane-database-proof` ComputeClass, whose
scale-up policy gives this bounded proof Job a real placement when system capacity-reservation Pods
fill otherwise idle nodes.

Applications connect through the chart's `-pooler-client` headless Service. It keeps one stable DNS
name while resolving only the CNPG-managed PgBouncer Pods, so a GKE NetworkPolicy can admit that
exact data path without permitting a direct connection to a PostgreSQL instance or pinning a Pod IP.

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
| Pinned PgBouncer image, pool size, client ingress, and pooler-to-instance egress | Reconciling the `Pooler` into its Deployment and Service |
| Supplying distinct application/admin Secret names, the app-owned target baseline reference, and database access | Bootstrapping the target SQL and reconciling roles/`Database` CRs |
| Selecting/enabling a backup plugin in values | Operator + CRD install (an external prerequisite) |

OpenCrane does **not** install or upgrade the CNPG operator, and does **not** generate, rotate, or
repair database credentials.

## Public surface

`Entrypoint:` the Helm chart under `helm/`. No importable code. Prerequisites the chart expects:

- a compatible CloudNativePG operator and CRDs, installed outside the OpenCrane release;
- access to the pinned `ghcr.io/cloudnative-pg/pgbouncer:1.25.1` Pooler image;
- one pre-created `kubernetes.io/basic-auth` Secret per logical database (`username`/`password`, where
  `username` equals that database's owner);
- one separate basic-auth Secret for the operational database administrator; its `username` must
  equal `databaseAdmin.name`, and both the username and Secret must differ from every application
  owner/Secret;
- one immutable target-baseline ConfigMap published from
  `apps/opencrane/prisma/bootstrap/target-baseline.sql` before a fresh install;
- the ConfigMap's full `opencrane.ai/baseline-sha256` identity supplied as
  `bootstrap.targetBaseline.sha256` for both fresh setup and physical recovery;
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
kubernetes_api_host_cidr() {
  case "$1" in
    *:*) printf '%s/128' "$1" ;;
    *) printf '%s/32' "$1" ;;
  esac
}
BASELINE_CONFIG_MAP="$(bash apps/postgres/scripts/publish-initdb-baseline-config-map.sh \
  opencrane opencrane apps/opencrane/prisma/bootstrap/target-baseline.sql)"
BASELINE_SHA256="$(kubectl get configmap "$BASELINE_CONFIG_MAP" \
  --namespace opencrane \
  -o jsonpath='{.metadata.annotations.opencrane\.ai/baseline-sha256}')"
KUBERNETES_API_SERVICE_IP="$(kubectl get service kubernetes --namespace default \
  -o jsonpath='{.spec.clusterIP}')"
KUBERNETES_API_SERVICE_PORT="$(kubectl get service kubernetes --namespace default \
  -o jsonpath='{.spec.ports[0].port}')"
KUBERNETES_API_ENDPOINT_PORT="$(kubectl get endpoints kubernetes --namespace default \
  -o jsonpath='{.subsets[0].ports[0].port}')"
KUBERNETES_API_ENDPOINT_ARGS=()
KUBERNETES_API_ENDPOINT_INDEX=0
while IFS= read -r endpoint_ip; do
  KUBERNETES_API_ENDPOINT_ARGS+=(--set-string \
    "networkPolicy.kubernetesApiServerEndpointCidrs[$KUBERNETES_API_ENDPOINT_INDEX]=$(kubernetes_api_host_cidr "$endpoint_ip")")
  KUBERNETES_API_ENDPOINT_INDEX=$((KUBERNETES_API_ENDPOINT_INDEX + 1))
done < <(kubectl get endpoints kubernetes --namespace default \
  -o jsonpath='{range .subsets[*].addresses[*]}{.ip}{"\n"}{end}')
OPENCRANE_RELEASE_VERSION="$(jq -r '.version' package.json)"
POSTGRES_OPERAND_IMAGE="$(jq -r '.database.operandImage' "releases/$OPENCRANE_RELEASE_VERSION.json")"
helm upgrade --install opencrane-postgres apps/postgres/helm \
  --namespace opencrane \
  --set-string image="$POSTGRES_OPERAND_IMAGE" \
  --set databaseAdmin.name=opencrane_database_admin \
  --set databaseAdmin.credentialsSecret=opencrane-postgres-admin \
  --set-string bootstrap.targetBaseline.sha256="$BASELINE_SHA256" \
  --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].name="$BASELINE_CONFIG_MAP" \
  --set-string bootstrap.initdb.postInitApplicationSQLRefs.configMapRefs[0].key=target-baseline.sql \
  --set-string networkPolicy.kubernetesApiServerCidrs[0]="$(kubernetes_api_host_cidr "$KUBERNETES_API_SERVICE_IP")" \
  --set networkPolicy.kubernetesApiServerPort="$KUBERNETES_API_SERVICE_PORT" \
  "${KUBERNETES_API_ENDPOINT_ARGS[@]}" \
  --set networkPolicy.kubernetesApiServerEndpointPort="$KUBERNETES_API_ENDPOINT_PORT" \
  --set databases[0].credentialsSecret=opencrane-postgres-bootstrap \
  --set databases[1].credentialsSecret=opencrane-obot-postgres-bootstrap \
  --set databases[2].credentialsSecret=opencrane-litellm-postgres-bootstrap
kubectl wait --for=condition=Ready cluster/opencrane-postgres \
  --namespace opencrane --timeout=5m
```

For normal installs and upgrades, use `apps/_infra/deploy-k8s/deploy.sh` with the release-version
flags rather than invoking this chart directly; the wrapper owns fencing, backup evidence, immutable
SQL publication, migration ordering, and recovery.

The chart requires exactly one target baseline for `initdb` and renders no SQL reference on
`recovery`. Both paths require the full expected digest. A hook reads the protected marker restored
inside the application database and accepts only a fresh current origin or the exact latest migration
history row, including its reviewed SQL digest. A migration manifest may admit several protected
origins when earlier adjacent upgrades preserve their original bootstrap marker. The deploy classifier
must prove that every history row forms one ordered chain, select the live marker from that admitted
set, and pass that digest to both migration and privilege Jobs. A caller therefore cannot relabel an
incompatible or partially migrated backup as current. Existing databases advance only through the
exact reviewed adjacent migration bound by the immutable repository release manifest. The chart owns
the bounded migration Job; the server never migrates on startup.

The deploy entrypoint requires `--release-version` and `--from-release-version`. Use `fresh` only for
an empty initdb install; use the exact current version to restore or reconcile a current database, and
the exact prior adjacent minor version to restore or upgrade that version. Patch, skipped-minor, major,
and unknown paths fail before mutation. Before an eligible prior-minor upgrade, the deploy owner reads
the protected origin and complete migration-history tuple in one read-only transaction. A current
baseline with no history is valid pre-ledger adoption, and an exact completed history is idempotent
re-entry: both run privileges with migration disabled and continue the normal application upgrade
without publishing SQL or fencing. Incompatible, unreadable, extra, or ambiguous evidence stops before
the server is changed. Only an exact source state proceeds:

1. for a live Cluster when the operator requires a backup, proves that the required
   [plugin-backed `ScheduledBackup`](https://cloudnative-pg.io/docs/1.27/backup/) exists before changing
   the application release;
2. captures the exact current application Helm revision, then scales the old server to zero through
   that release and persists a visible migration fence;
3. reconciles or restores PostgreSQL, proves that the server preloads `pg_cron`, and publishes the
   manifest-selected SQL as an immutable, content-addressed ConfigMap;
4. rechecks the chart-owned plugin-backed `ScheduledBackup`, creates an immediate CNPG `Backup`, and
   waits for `status.phase=completed`, unless the invocation explicitly passes
   `--allow-unbacked-database-migration`;
5. runs the digest-pinned, zero-RBAC app-owner Job with deadline, no retry, read-only root, scratch,
   and egress limited to DNS plus the exact CNPG pods on TCP 5432; and
6. runs schema convergence before database privilege reconciliation, then restores the previous
   replica count only after the whole migration succeeds.

An interactive deployment asks whether to require recovery backup before a real migration. Answering
no, or passing the CLI-only `--allow-unbacked-database-migration` flag in a non-interactive run, skips
the preflight in step 1 and Backup creation in step 4. Source classification, fencing, immutable SQL
publication, the migration Job, convergence, privilege reconciliation, and recovery remain mandatory.
Never make the opt-out a persistent deployment default.

After any post-fence failure, the deploy owner checks that the migration Job is absent or terminal and
reclassifies the database. It restores the exact captured Helm revision only if the database is still
the exact source state. A current, completed, incompatible, or unreadable state, an active or unknown
Job, or a rollback failure leaves `migrationFence.active=true` and the server at zero replicas; the
original deployment error remains the reported status. Recovery is then backup restore or a reviewed
forward repair; do not clear the fence by scaling with `kubectl`. A missing live Cluster additionally
requires an explicit physical-recovery profile before fencing, and the recovered database must pass
the same state classification before SQL publication. If deployment stops after migration, completed
re-entry adopts only an exact matching persisted fence; un-fencing, consumer restart, and rollout
failures restore that fenced Helm revision while preserving the original failure. The executor image defaults to the reviewed
digest-qualified CNPG PostgreSQL 17.5 image;
`OPENCRANE_POSTGRES_MIGRATION_IMAGE` or `--postgres-migration-image` may override it only with another
exact `@sha256:` identity.

The k3d acceptance path server-dry-runs both contracts against the pinned CNPG CRDs, installs a pinned
Barman Cloud plugin and MinIO test target, writes a marker, completes an on-demand physical backup,
recovers a fresh Cluster, proves a false baseline claim is rejected, and verifies the data marker
through the recovered application Secret.

NetworkPolicy also requires the exact Kubernetes API Service and backing endpoint addresses. CNPG's
PgBouncer manager watches its `Pooler` and Secrets through that API; the two CIDR lists keep this
control path available whether the cluster enforces egress before or after Service translation. Use
`/128` rather than `/32` for IPv6, and list every API endpoint on a highly available control plane.

## See also

- Parent index: [apps](../README.md)
- Consumers: [opencrane server](../opencrane/README.md) · [litellm](../_infra/litellm/README.md) ·
  [obot](../_infra/obot/README.md)
- Silo chart that composes it: [apps/_infra/deploy-k8s](../_infra/deploy-k8s/README.md)
