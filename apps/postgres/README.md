# PostgreSQL

`apps/postgres` owns OpenCrane's durable PostgreSQL deployable. Its Helm chart declares one
CloudNativePG `Cluster`, expandable mounted storage, ingress isolation, and optional plugin-based
backup or recovery. Application data is retained indefinitely; operators grow the PVC request as
the tenant's durable data grows.

The Cluster is retained on Helm uninstall. Database deletion is an explicit operator action, never
a release-side effect.

The chart expects three cluster-level prerequisites:

- a compatible CloudNativePG operator and CRDs, installed outside the OpenCrane release;
- one pre-created `kubernetes.io/basic-auth` Secret per logical database, containing `username`
  and `password`, where `username` exactly equals that database's owner;
- a mounted `ReadWriteOnce` StorageClass with volume expansion enabled.

OpenCrane does not install or upgrade the operator and does not generate, rotate, or repair database
credentials. One CNPG Cluster hosts `opencrane`, `obot`, `litellm`, and `langfuse` (and `fleet` in
the fleet profile). CNPG bootstraps the first database, then declaratively reconciles the remaining
least-privilege roles and `Database` CRs. The deployment flow publishes one application connection
Secret per logical database via `scripts/publish-app-connection-secret.sh`; it adds the connection
URI without sharing credentials across authorities or exposing them in command arguments or logs.
There is one narrow workload-identity exception to normal app ownership: CloudNativePG, as the
database Pod controller, generates the instance-manager `ServiceAccount` and its narrowly scoped
`Role`/`RoleBinding`. Their deterministic name equals the CNPG Cluster name (`<release>`), which the
Cluster publishes in the `opencrane.ai/cnpg-service-account` annotation. The app owns the desired
Cluster and network boundary, while the external controller owns only the runtime identity it must
reconcile. This chart therefore must not render a competing `ServiceAccount`, `Role`, or
`RoleBinding`.

Install the database before the server release:

```bash
helm upgrade --install opencrane-postgres apps/postgres/helm \
  --namespace opencrane --create-namespace \
  --set databases[0].credentialsSecret=opencrane-postgres-bootstrap \
  --set databases[1].credentialsSecret=opencrane-obot-postgres-bootstrap \
  --set databases[2].credentialsSecret=opencrane-litellm-postgres-bootstrap \
  --set databases[3].credentialsSecret=opencrane-langfuse-postgres-bootstrap
kubectl wait --for=condition=Ready cluster/opencrane-postgres \
  --namespace opencrane --timeout=5m
```

`scripts/publish-app-connection-secret.sh` creates an application Secret for one logical database;
its `uri` key is that database's canonical connection URI. Each application role can authenticate
only to its own database; there are no shared owner roles or credentials.

Backup and restore stay disabled until the cluster has the CNPG-I Barman Cloud plugin. When backup is
enabled, this chart owns the per-ClusterTenant `ObjectStore` and its Barman retention policy; the
destination configuration references pre-created credential Secrets and must be unique to that
ClusterTenant. The infrastructure policy contract is deliberately small:

- `backup.enabled` switches scheduled backup and WAL archiving on or off;
- `backup.frequency` is one of `daily`, `weekly`, or `monthly` and selects the generated
  `ScheduledBackup` cadence;
- `backup.retainedCopies` is at least one and maps to Barman's retention window: for example,
  seven daily copies becomes `7d`, while four weekly copies becomes `4w`.

Barman enforces a point-in-time recovery window, including required WAL; it is not an exact
base-backup-count deleter, so immediate/manual backups can make the physical count differ at the
window edge. Phase F / #224 owns the ClusterTenant-admin UI and its storage-cost explanation; its
reconciler writes this chart contract rather than leaving retention in a hand-managed ObjectStore.
Enabling backups without an object-store name and destination fails Helm rendering.

The k3d acceptance path server-dry-runs both contracts against the pinned CNPG CRDs, then installs a
pinned Barman Cloud plugin and MinIO test target, writes a marker, completes an on-demand physical
backup, recovers a fresh Cluster, and verifies the marker through the recovered application Secret.
