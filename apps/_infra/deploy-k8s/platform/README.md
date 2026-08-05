# deploy-k8s platform internals

This directory is the cluster and release substrate owned by `apps/_infra/deploy-k8s`. It is kept
as an internal subtree—not a top-level `libs` package—because the deploy-k8s application is its only
local source consumer.

## Contents

| Path | Responsibility |
|---|---|
| `Chart.yaml`, `templates/` | Helm library chart providing labels, names, RBAC, endpoint, database, identity, and observability helpers to the parent release. It renders no workload by itself. |
| `k8s-deploy.sh` | Provider-neutral install and upgrade engine used by the release wrapper. Its optional `--verify` check reports pod readiness, DNS resolution, and public server/database health without changing deployment success. |
| `bootstrap-prerequisites.sh` | Explicit operator bootstrap for the pinned ingress-nginx, cert-manager, and CloudNativePG cluster-wide controllers. It validates the exact Kubernetes context and reserved regional address before mutation, fails closed around existing foreign resources, and installs resource-bounded GKE Autopilot development profiles from `values/prerequisites/`. It is not invoked by a silo deployment. |
| `prerequisite-chart-lock.sh` | Immutable upstream chart coordinates, SHA-256 archive identities, and complete rendered cluster-scoped resource inventories consumed by the bootstrap and render contract. |
| `configure-oidc.sh` | Surgical OIDC configuration for an existing installation. |
| `provision.sh` | Optional local, GKE Autopilot, or VPS cluster provisioning invoked before deployment. The GKE path bootstraps a private, versioned Terraform-state bucket in the cluster region; set `OPENCRANE_TERRAFORM_STATE_BUCKET` only when the deterministic `<project>-<cluster>-tfstate` name cannot be used. |
| `terraform/` | GKE Autopilot with regional CMEK, plus opt-in networking, DNS, and Artifact Registry resources. Application charts remain owned by `deploy.sh`. |
| `values/` | Reusable environment and multi-instance deployment profiles. |
| `tests/` | Rendered network, pooler, key-permission, post-deploy health, and skill-workload contract checks. |

Business logic does not belong here. Server-process infrastructure belongs in `libs/backend/_server`;
backend capabilities belong in `libs/backend/server`; independently owned third-party workloads
belong in sibling `apps/_infra/<service>` projects.

## Shared controller bootstrap

Cluster-wide controllers remain outside the organisation release boundary. A cluster operator may
install the supported development substrate explicitly after provisioning a GKE Autopilot cluster:

```bash
apps/_infra/deploy-k8s/platform/bootstrap-prerequisites.sh \
  --context gke_PROJECT_REGION_CLUSTER \
  --project-id PROJECT \
  --region europe-west1 \
  --ingress-address-name RESERVED_ADDRESS \
  --yes
```

The command downloads each locked archive once, verifies its committed SHA-256, renders that local
archive before it changes the cluster, then installs the same bytes with atomic, waited Helm upgrades.
Its complete cluster-scoped inventory prevents accidental adoption of foreign CRDs, RBAC, ingress
classes, or webhooks. Bootstrap-owned namespaces carry explicit retry markers so an atomic first-run
failure can be retried without accepting an arbitrary pre-existing namespace. It never installs
external-dns or DNS credentials and it does not create a cluster-wide certificate issuer. Each silo
owns its namespaced HTTP-01 `Issuer`; the operator creates the serving DNS record only after the
ingress Service reports the reserved address.

The pinned ingress-nginx release is accepted only for this single-silo development qualification.
The upstream project is archived, so a supported ingress controller must replace it before a
production or shared multi-tenant deployment.
