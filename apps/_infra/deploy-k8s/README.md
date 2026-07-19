# Kubernetes silo release

`apps/_infra/deploy-k8s` owns the `opencrane-silo` umbrella Helm chart and the deploy
entrypoint — one release per ClusterTenant, into that org's own namespace. The umbrella
composes app-owned Helm units as pinned `file://` dependencies (opencrane-server,
opencrane-ui, channel-proxy, Cognee, LiteLLM, Obot, the wrapped upstream Langfuse) and
includes each unit's exported named templates with the unchanged parent release context
(`templates/app-rollups.yaml`). Every workload's chart lives with its app; this project only
composes them.

It also owns the deploy-only pieces no single app can: the ClusterTenant/Tenant/AccessPolicy
CRDs (`templates/crds/`, gated by `crds.install` so a fleet-managed install does not contend
with the fleet's copy), the cert-manager cluster issuer, the default-deny and multi-instance
NetworkPolicies, the external-secrets store, and the pre-install/pre-upgrade Prisma
schema-reconciliation Job (`components/database-schema/`, which reuses the server image and
holds database-only authority).

`deploy.sh` is the per-silo profile over the provider-neutral install engine
`platform/k8s-deploy.sh`; all cluster changes go through these scripts, never bare `helm` or
`kubectl`. Dependencies resolve from `Chart.lock` via `helm dep build`, so versions are
pinned exactly and bumped deliberately. Cluster-wide controllers (ingress-nginx,
external-dns, CloudNativePG, cert-manager) are external prerequisites a silo never installs,
and each database is a separate app-owned PostgreSQL release with a pre-created credentials
Secret.

Tagged `type:app`, `layer:entrypoint`, `scope:deployment`. Deeper detail lives in
[`platform/README.md`](./platform/README.md) (engine, library chart, terraform, tests),
[`components/database-schema/README.md`](./components/database-schema/README.md), and the
service map in [`apps/_infra/README.md`](../README.md).
