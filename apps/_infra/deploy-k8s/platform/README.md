# deploy-k8s platform internals

This directory is the cluster and release substrate owned by `apps/_infra/deploy-k8s`. It is kept
as an internal subtree—not a top-level `libs` package—because the deploy-k8s application is its only
local source consumer.

## Contents

| Path | Responsibility |
|---|---|
| `Chart.yaml`, `templates/` | Helm library chart providing labels, names, RBAC, endpoint, database, identity, and observability helpers to the parent release. It renders no workload by itself. |
| `k8s-deploy.sh` | Provider-neutral install and upgrade engine used by the release wrapper. Its optional `--verify` check reports pod readiness, DNS resolution, and public server/database health without changing deployment success. |
| `configure-oidc.sh` | Surgical OIDC configuration for an existing installation. |
| `provision.sh` | Optional local, GKE, or VPS cluster provisioning invoked before deployment. |
| `terraform/` | GKE, networking, DNS, Artifact Registry, Workload Identity, and optional chart installation. |
| `values/` | Reusable environment and multi-instance deployment profiles. |
| `tests/` | Rendered network, pooler, key-permission, post-deploy health, and skill-workload contract checks. |

Business logic does not belong here. Server-process infrastructure belongs in `libs/server/_infra`;
backend capabilities belong in `libs/backend/server`; independently owned third-party workloads
belong in sibling `apps/_infra/<service>` projects.
