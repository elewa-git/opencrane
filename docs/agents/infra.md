# Build, Test & Infrastructure

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

## Build And Test

The workspace uses npm workspaces with integrated NX for task coordination.

- Install deps: `npm ci`
- Build all: `npm run build` (runs `npx nx run-many -t build`)
- Test all: `npm run test` (runs `npx nx run-many -t test`)
- Build single app: `npm run build -w @opencrane/server` (or `npx nx run opencrane:build`)
- Test single app: `npm run test -w @opencrane/server` (or `npx nx run opencrane:test`)
- Test only affected packages (PR): `npx nx affected -t test build lint --base=origin/main`

### NX Cloud (Remote Caching & Distributed CI)

NX Cloud provides remote task caching and optional CI task distribution (test/lint/build parallelization across runners).

- **Local setup:** Run `npx nx connect` to authenticate and write `nxCloudId` to `nx.json`.
- **CI enablement:** Uncomment the `Initialize NX Cloud CI` step in `.github/workflows/docker.yml` to activate remote caching + distributed task execution on PRs.
- **Benefits:** CI build/test times drop sharply on PRs when only a subset of packages changed (the `nx affected` check re-runs only affected projects + their dependents).

See `nx.json` for caching policies (inputs, namedInputs) and target defaults (dependsOn, cache settings).

## Infrastructure Architecture Context

Verified June 2026:

- **`multiInstance.enabled` is the master switch** for coexisting multiple OpenCrane installs in one cluster. It flips: operator + opencrane-api RBAC from `ClusterRole`/`ClusterRoleBinding` → namespaced `Role`/`RoleBinding`; cert issuer `ClusterIssuer` → namespaced `Issuer`; external-secrets `ClusterSecretStore` → namespaced `SecretStore`; CRDs install once cluster-wide (`--skip-crds` on releases); and a default-deny cross-instance `NetworkPolicy` per namespace. Scope resolution lives in the `k8s-platform` Helm library chart's `apps/_infra/deploy-k8s/platform/templates/_helpers.tpl` (e.g. `opencrane.mcpGatewayUrl`, `opencrane.litellmShared`), which picks release-prefixed in-cluster names vs. external shared endpoints.
- **Each plane is independently `instance` (release-local) or `shared`** (LiteLLM, Obot, feat-skill-registry, external-secrets) via `values.yaml` — so one install can BYO a shared LiteLLM while owning its own gateway.
- **Terraform has two entry points:** `apps/_infra/deploy-k8s/platform/terraform/cloud/gcp/main.tf` provisions the full GCP stack in 5 phases (VPC/subnets → **GKE Autopilot**, private nodes → Artifact Registry → in-cluster Bitnami PostgreSQL + the OpenCrane chart → Cloud DNS zone + reserved static global IP + the shared DNS-writer Workload-Identity binding); `apps/_infra/deploy-k8s/platform/terraform/core/main.tf` is **cloud-agnostic** (assumes a ready kubeconfig, applies the chart only — works on k3d, EKS, AKS, on-prem). Terraform writes only the **install-time** records (apex, `*.<domain>`, opencrane-api host) into the zone; **per-org `<org>.<domain>` A records are written at runtime by external-dns** from the operator's `DNSEndpoint` CRs — Terraform never writes them. The platform `*.<domain>` wildcard covers org hosts `<org>.<domain>` (one label); that is all that is needed because there are no per-user subdomains. The `dns` module also provisions the single `roles/dns.admin` GSA that BOTH external-dns and the cert-manager DNS-01 solver impersonate (one binding, shared). `<domain>` is the platform base domain. See [`cluster-architecture.md` → Tenancy Model](./cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant).
- **GCS buckets are provisioned in-operator at reconcile time via Workload Identity, NOT by Terraform.** Terraform sets up cloud IAM/networking; per-UserTenant storage is a runtime operator concern.
- **Deploy scripts.** The fleet (multi-tenant) deploys via `apps/fleet-platform/deploy.sh`, each silo via `apps/_infra/deploy-k8s/deploy.sh`, and one seeded org via `apps/_infra/deploy-k8s/platform/deploy-single-tenant.sh` (fleet + one silo in two passes). All drive the shared engine `apps/_infra/deploy-k8s/platform/k8s-deploy.sh` (+ `configure-oidc.sh`). **Provisioning is built into the multi/single deploy scripts:** `--provision local|gke|vps` (sourced from `apps/_infra/deploy-k8s/platform/provision.sh`) creates + targets a k3d / GKE-via-Terraform / k3s-VM cluster before installing; without it they deploy onto the current kubectl context. (This absorbed the old standalone `install.sh` / `gke-deploy.sh` / `vps-deploy.sh`; the `deploy.sh` dispatcher + `wizard.sh` were removed as stale routers. `platform/` no longer exists.) Local dev iteration still uses the k3d harness `apps/_infra/deploy-k8s/platform/tests/k3d-local.sh` with value profiles in the same dir: `values-k3d-local.yaml` (fast), `-strict.yaml` (prod-like), `-e2e.yaml`.
- **`apps/_infra/deploy-k8s/platform/tests/multi-instance-conformance.sh` validates isolation statically** via `helm template` (no live cluster) — checks per-instance `WATCH_NAMESPACE`, namespaced RBAC, absence of cross-instance cluster-scoped issuers/stores, and default-deny NetworkPolicies. Run it after touching Helm RBAC/scope logic.
- **`apps/_infra/deploy-k8s` uses one local ClusterTenant authority topology.** It self-seeds
  the ClusterTenant and owns namespace/domain provisioning. `values/standalone.yaml` remains a
  concise local-install profile; see [`apps/opencrane.md` → "Deployment topology"](./apps/opencrane.md).

## Infrastructure Layout

Infrastructure-as-code lives under `apps/_infra/` (deployment-only components and the silo composer)
and `apps/_infra/deploy-k8s/platform/` (the shared engine, Terraform, and tests):

| Path | Owns |
|------|------|
| `apps/_infra/deploy-k8s/platform/terraform/` | Cloud identities, trust bindings, IAM role attachments |
| `apps/fleet-platform/` (chart `opencrane-fleet`) | Central-plane K8s service accounts, RBAC bindings, workload identity annotations, NetworkPolicy, CRDs |
| `apps/_infra/deploy-k8s/` (chart `opencrane-silo`) | Umbrella composition, deployment profiles, CRDs, issuers, external-secret wiring, and app-owned workload composition |
| `apps/{opencrane,opencrane-ui,artifact-service}/helm/`, `apps/_infra/{cognee,litellm,obot}/helm/` | App-owned Helm library units for current per-silo workloads and their policy/identity contracts |
| `apps/_infra/langfuse/` | Pinned upstream wrapper and explicit six-class workload inventory; the umbrella retains the direct dependency for render parity |
| `apps/_infra/deploy-k8s/platform/` (Helm library chart + shared deploy engine) | Shared named-templates (`templates/_helpers.tpl`), `k8s-deploy.sh` / `configure-oidc.sh` / `provision.sh` / `deploy-single-tenant.sh` |
| `apps/fleet-platform/deploy.sh`, `apps/_infra/deploy-k8s/deploy.sh` | Fleet / silo deploy flows |
| `apps/_infra/deploy-k8s/platform/deploy-single-tenant.sh`, `provision.sh` | Single-org orchestrator + shared cluster provisioning (`--provision local/gke/vps`) |
| `apps/_infra/deploy-k8s/platform/tests/` | Platform-level tests |

## Terraform / Helm Split Of Responsibility

This split is the concrete implementation of the [Central Identity Model](./architecture.md#central-identity-model):

- **Terraform** defines cloud identities, trust bindings, and IAM role attachments — cloud IAM is the source of truth for cloud resource access.
- **Helm** defines Kubernetes service accounts, RBAC bindings, and workload identity annotations — Kubernetes RBAC is the source of truth for Kubernetes API access.
- Application code should consume the identity these layers provision, never invent a parallel auth scheme.

See [`k8s.md`](./k8s.md) for the per-service defaults (dedicated service accounts, token automount, least-privilege RBAC) these templates must satisfy.
