# PostgreSQL

`apps/postgres` owns OpenCrane's durable PostgreSQL deployable. Its Helm chart declares one
CloudNativePG `Cluster`, expandable mounted storage, ingress isolation, and optional plugin-based
backup or recovery. Application data is retained indefinitely; operators grow the PVC request as
the tenant's durable data grows.

The Cluster is retained on Helm uninstall. Database deletion is an explicit operator action, never
a release-side effect.

The chart expects three cluster-level prerequisites:

- a compatible CloudNativePG operator and CRDs, installed outside the OpenCrane release;
- a pre-created `kubernetes.io/basic-auth` Secret containing `username` and `password`, where
  `username` exactly equals `database.owner` (the default is `opencrane`);
- a mounted `ReadWriteOnce` StorageClass with volume expansion enabled.

OpenCrane does not install or upgrade the operator and does not generate, rotate, or repair database
credentials. The deployment flow publishes one authority-local application connection Secret from
the supplied basic-auth Secret via `scripts/publish-app-connection-secret.sh`; it adds the connection
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
  --set credentials.existingSecret=opencrane-postgres-bootstrap
kubectl wait --for=condition=Ready cluster/opencrane-postgres \
  --namespace opencrane --timeout=5m
```

`scripts/publish-app-connection-secret.sh` creates `<cluster>-app`; its `uri` key is the canonical
connection URI for that one database target. OpenCrane, fleet, Obot, and DB-backed LiteLLM use
separate CNPG Cluster releases rather than sibling databases or shared migration histories. Backup
and restore stay disabled until a CNPG-I plugin and its object-store resource are installed and
explicitly selected in values. The k3d acceptance path server-dry-runs both contracts against the
pinned CNPG CRDs, then installs a pinned Barman Cloud plugin and MinIO test target, writes a marker,
completes an on-demand physical backup, recovers a fresh Cluster, and verifies the marker through the
recovered application Secret.
