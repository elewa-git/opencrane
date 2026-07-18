# Kubernetes Cluster Architecture

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) and [`k8s.md`](./k8s.md).
> This is the authoritative topology reference. Operational coding rules (service-account defaults,
> auth-less routes, Workload Identity) are in [`k8s.md`](./k8s.md); the Helm/Terraform ownership
> split is in [`infra.md`](./infra.md). Verified against the tree June 2026.

## Mental Model

OpenCrane runs a **containerised control plane + reconciling operator + per-UserTenant agent pods** in
one Kubernetes cluster. The cluster is built to host **N strictly-isolated customer instances side by
side** — each customer is a **ClusterTenant**, each per-user OpenClaw gateway is a **UserTenant** (see
[Tenancy Model](#tenancy-model--clustertenant-vs-usertenant)). A Helm chart deploys the platform planes
(release-local by default); the operator then creates UserTenant workloads at runtime. Isolation
strength is a per-customer choice (`isolationTier`).

```
┌────────────────────────────────────────────────────────────────────────┐
│  Kubernetes cluster  (GKE Autopilot in cloud; k3d/EKS/AKS/on-prem also)  │
│                                                                          │
│  Cluster-scoped (once):  CRDs · ClusterTenant CRs · (MI) cross-inst deny │
│                                                                          │
│  ┌── install / instance namespace (e.g. "opencrane" or "oc-acme") ────┐ │
│  │  PLATFORM PLANES (Helm-deployed, 1 replica each by default)         │ │
│  │   • operator            reconciles CRs → tenant workloads           │ │
│  │   • opencrane-api :8080  API /api/v1 + internal /api/internal       │ │
│  │   • litellm     :4000    LLM cost/budget proxy (egress for pods)    │ │
│  │   • mcp-gateway :8080    Obot — MCP runtime, polls opencrane-api    │ │
│  │   • artifact-service :8080 canonical ArtifactStore CAS on PVC          │ │
│  │                                                                     │ │
│  │  USERTENANT WORKLOADS (operator-created, one set per Tenant CR)     │ │
│  │   Deployment(OpenClaw, 1 replica) · Service · Ingress · ConfigMap   │ │
│  │   · Secrets(enc-key, litellm-key) · SA · (CT) ResourceQuota+LimitRange │
│  └─────────────────────────────────────────────────────────────────────┘ │
│         ▲ external traffic: GCE LB (GCP) / ingress-nginx (on-prem)       │
│  opencrane-api host → opencrane-api:8080 · *.<base> → operator proxy → UserTenant pods │
└────────────────────────────────────────────────────────────────────────┘
```

## Tenancy Model — ClusterTenant vs UserTenant

OpenCrane has **two distinct tenant concepts**. Keep them straight. Under the **fixed-wildcard
topology** the platform owns ONE wildcard base domain and every org/user name is **derived** under it
— customers no longer bring their own domain (a vanity domain is an optional overlay, see below):

| Term | What it is | Scope | Domain |
|------|-----------|-------|--------|
| **ClusterTenant** | The **customer / isolation unit (org)** — owns a namespace, a `ResourceQuota`/`LimitRange`, and a compute `isolationTier`. | Cluster-scoped CRD `clustertenants.opencrane.io`. | **Derived** apex `<org>.<base>` under the platform wildcard `*.<base>` (e.g. `acme.weownai.eu`). NOT customer-owned. An optional `vanityDomain` CNAMEd onto that apex is an overlay. |
| **UserTenant** | A **per-user OpenClaw agent gateway** — the workload a person connects to. This is the `Tenant`/openclaw CRD; **"UserTenant" is the canonical name**, "`Tenant`" is the legacy CRD kind in code. | Namespaced CRD `tenant.opencrane.io`, runs inside its ClusterTenant's namespace. | No public host of its own. Users connect through the org host `<org>.<base>`; the identity-routing proxy (in the operator) routes each session to its pod at `openclaw-<user>.<ns>.svc` internally. |

### DNS hierarchy

There are exactly **two platform-owned DNS entries** — a fixed super-operator/opencrane-api host, and one
platform wildcard base — under which every org name is **derived** (one flat DNS tree, not per-customer
domains). There are **no per-user subdomains**:

```
platform.weownai.eu             → control plane (the FIXED super-operator host)   [platform-owned, distinct]
*.weownai.eu                    → resolves every ORG HOST                          [platform wildcard, set once at install]
  acme.weownai.eu               → ClusterTenant "acme" — all acme users connect here [explicit A record via external-dns]
  globex.weownai.eu             → ClusterTenant "globex" — all globex users connect here

  ai.client-company.com         → OPTIONAL customer-vanity domain, CNAMEd by the customer onto acme.weownai.eu
```

The identity-routing proxy (folded into the ClusterTenant operator) receives all gateway WebSocket
upgrades at `<org>.<base>`, resolves each user's session via `GET /api/v1/auth/gateway-resolve` on the
control plane, and reverse-proxies to the correct pod at `openclaw-<user>.<ns>.svc` inside the cluster.
UserTenant pods are **not** exposed on their own public host.

- **Control plane** → the **fixed super-operator host** (`ingress.controlPlaneHost`, defaults to
  `platform.<base>`). It is one management API above every org — a distinct host, **never** an org under
  `*.<base>`. Wired by `opencrane-api-ingress.yaml`.
- **Org host** → an explicit `<org>.<base>` A record emitted by the operator as an external-dns
  `DNSEndpoint` at org-provision time; external-dns reconciles it into the zone. Resolved by the platform
  wildcard `*.<base>`.
- **UserTenant routing** → the operator no longer builds per-user Ingress objects. A single wildcard
  Ingress at `*.<base>` routes `/api` to the control plane and the gateway WebSocket path to the
  operator's proxy Service. The proxy does the per-user routing internally.
- **Customer vanity domain** → OPTIONAL. The customer adds a `CNAME` at their own provider pointing
  their domain at the org host `<org>.<base>` (see [DNS config](/operators/dns-config) for the exact
  instruction). The operator issues a per-org HTTP-01 cert carrying the vanity SAN. It is an overlay,
  not the org's identity.

> **Note (June 2026):** the operator derives per-org DNS records via `DefaultOrgDomainProvisioner`
> (`apps/fleet-operator/src/cluster-tenants/internal/org-domain.provisioner.ts`); the platform
> cert-manager `Certificate` covers `*.<base>` + apex + the opencrane-api host
> (`cluster-issuer.yaml`); the opencrane-api host is wired by `opencrane-api-ingress.yaml`.
> `*.<base>` matches **org hosts** `<org>.<base>` — one label — which is sufficient because
> there are no per-user subdomains to cover.

## Physical Cluster

- **Cloud target: GKE Autopilot** (`apps/_infra/deploy-k8s/platform/terraform/cloud/gcp/`) — Google-managed nodes, pay-per-pod, private nodes, VPC-native with secondary IP ranges for pods/services, Cloud NAT egress, an install-time Cloud DNS wildcard (`*.<base>`, covering org hosts `<org>.<base>`) pointing at a reserved static global IP. Per-org `<org>.<base>` A records are emitted at runtime by the operator as external-dns `DNSEndpoint` CRs. Provisioned in phases: networking → cluster → Artifact Registry → in-cluster Bitnami PostgreSQL + the chart → DNS.
- **Cloud-agnostic target** (`apps/_infra/deploy-k8s/platform/terraform/core/`) — assumes a ready kubeconfig and applies only the chart; works on k3d (local dev/e2e), EKS, AKS, on-prem. `hosting.provider: onprem` makes cloud storage/identity no-ops.

## Helm Template Inventory

The per-silo `opencrane-silo` chart at `apps/_infra/deploy-k8s` is a composer, not the
anonymous owner of its workloads. `templates/app-rollups.yaml` includes app-owned Helm
library units with the parent release context; shared labels and topology helpers remain in
`apps/_infra/deploy-k8s/platform/templates/_helpers.tpl`.

| Owner | Creates |
|-------|---------|
| `apps/opencrane/helm` | Control-plane Deployment, Service, Ingress/certificate, SA/RBAC, gateway-proxy Service, and server NetworkPolicy |
| `apps/_infra/deploy-k8s/components/database-schema` | DB-only Prisma migration Job using the exact server image, with no mounted ServiceAccount token |
| `apps/opencrane-ui/helm` | Optional administration SPA Deployment and Service |
| `apps/_infra/cognee/helm` | Cognee Deployment, Service, PVC, identity, probes, and NetworkPolicy |
| `apps/_infra/litellm/helm` | LiteLLM Deployment, Service, credential Secret contract, and non-token identity |
| `apps/_infra/obot/helm` | Obot gateway Deployment, Service, KSA/RBAC, and NetworkPolicy |
| `apps/_infra/langfuse` | Pinned upstream chart ownership for web, worker, ClickHouse, ZooKeeper, Valkey, and MinIO workload classes |
| `apps/artifact-service/helm` | Canonical ArtifactStore byte service: RWO expandable PVC, private service, and no catalog authority |
| `apps/_infra/deploy-k8s/templates/{cluster-issuer,external-secrets-store,networkpolicy-*}.yaml` | Issuer/external-secret composition and cross-plane/default-deny policy |

The machine-enforced inventory is `docs/agents/workload-ownership.json`; adding a pod class
without an exact owner or direct deletion decision fails `scripts/phase-b-topology.sh`.

## The Planes, Wired

All planes are **ClusterIP-only** (no external LB) — external traffic arrives through Ingress. Internal DNS is `<release>-<plane>.<namespace>.svc`. Each plane is independently release-local (`instance`) or `shared` via `values.yaml` (`sharedPlatform.*`).

- **operator** → Kubernetes API only. Watches Tenant/AccessPolicy/ClusterTenant CRs; injects the other planes' URLs into tenant pods. Deep-dive: [`apps/fleet-operator.md`](./apps/fleet-operator.md).
- **opencrane-api** (`:8080`) → Postgres + K8s API + Cognee + LiteLLM. The hub everything else talks to. Deep-dive: [`apps/opencrane.md`](./apps/opencrane.md).
- **mcp-gateway / Obot** (`:8080`) → holds downstream MCP credentials and executes MCP tools;
  tenant pods reach MCP servers through it (projected token `aud=obot-gateway`). OpenCrane remains
  the catalog/grant authority; the removed registry-poll route is not a synchronization mechanism.
- **artifact-service** (`:8080`) → owns only content-addressed artifact bytes on its mounted PVC. It runs in the release's dedicated `<release>-artifacts` namespace with the receipt-signing key; OpenCrane remains the catalog and authorization authority in the control namespace, holds only the lease signer, and tenant/runtime pods never mount the volume.
- **litellm** (`:4000`) → the only LLM egress path for tenant pods; operator mints a per-tenant virtual key Secret; enforces budget.

## Namespace Model

**Single-install (default):** one release namespace holds all planes + all UserTenant workloads; CRDs and RBAC are cluster-scoped singletons. Ref-less UserTenants land here (an implicit "default" ClusterTenant binds this namespace).

**Multi-instance (`multiInstance.enabled: true`):** each customer install gets its own namespace (`oc-acme`, `oc-globex`, …) with its own planes, namespaced RBAC, namespaced cert Issuer/SecretStore, and a default-deny cross-instance NetworkPolicy. CRDs are installed **once** cluster-wide (`--skip-crds` on releases). See [Multi-Instance](#multi-instance-cluster-shape).

**Per-ClusterTenant fencing (when a UserTenant has `clusterTenantRef`):** the operator provisions/uses the parent's bound namespace with a **PSA `baseline`** label, a `ResourceQuota` (cpu/mem/pods/storage/gpu), and a `LimitRange` (per-container defaults — required because the quota constrains `requests.*`). `baseline` (not `restricted`) because silos run 3rd-party planes — Obot ships an embedded root Postgres with no `USER`, Cognee runs as root, Langfuse subcharts — that cannot satisfy `restricted`; `baseline` still blocks privileged containers, host namespaces, `hostPath`, and host ports. Tightening to `restricted` behind a leaner non-root gateway is tracked as a security follow-up.

## Network Topology

- **Ingress:** GCE Ingress (GCP) or ingress-nginx (on-prem). The **control plane** is reached on the **fixed super-operator host** (`ingress.controlPlaneHost`, default `platform.<base>`); org hosts `<org>.<base>` are resolved by the platform wildcard `*.<base>` and routed via a single wildcard Ingress to the operator's identity-routing proxy (gateway WebSocket) and the control plane (API). There are no per-user Ingress objects. See [Tenancy Model](#tenancy-model--clustertenant-vs-usertenant).
- **App-owned NetworkPolicies** restrict ArtifactStore ingress to the OpenCrane server only across the control-to-artifact namespace boundary; its PVC is mounted only in the artifact-service pod. Server RBAC is namespaced to its explicit control/tenant namespaces and cannot read the artifact namespace receipt signer. The server's `/api/internal/*` listener remains separately protected by its own policy and is never internet-routable.
- **Tenant egress** is default-DNS + the CIDR/FQDN allow-lists compiled from the tenant's AccessPolicy (standard NetworkPolicy always; optional CiliumNetworkPolicy for FQDN filtering).
- **TLS:** one **platform** cert (`*.<base>` + apex + opencrane-api host), issued via cert-manager DNS-01. It covers every org host `<org>.<base>`. A per-org HTTP-01 cert is issued only when a `vanityDomain` is set on the ClusterTenant. The platform cert is rendered by the chart; per-org vanity certs by the cluster-tenants operator. There are no per-org wildcard certs.

### TLS certificates

Because users connect to their org at `<org>.<base>` — a single label under the platform wildcard — the
platform `*.<base>` cert covers every org host. No per-org wildcard cert is needed:

| Cert | Covers | Challenge | Issued by |
|------|--------|-----------|-----------|
| **Platform** `*.<base>` (+ `<base>` + opencrane-api host) | every org host `<org>.<base>`, the apex, the fixed opencrane-api host | DNS-01 (wildcard requires DNS-01) | the chart (`cluster-issuer.yaml`) at install |
| **Per-org vanity** (SAN = customer vanity host) | the vanity host only, e.g. `ai.client-company.com` | HTTP-01 | the cluster-tenants operator at org-provision, only when `vanityDomain` is set |

The control plane persists the org and hands off to the operator, which calls the
[`OrgDomainProvisioner`](#org-provisioning-hand-off) seam to emit the org's DNS record and, when a
vanity domain is present, the HTTP-01 cert. The platform wildcard cert is issued once by the chart and
auto-renewed; it requires no per-org action.

### Org provisioning hand-off

When an org is created (`POST /api/v1/cluster-tenants`), the control plane persists desired state and
hands off the cluster-side side effects to the ClusterTenant operator/CR watcher. The interface the
reconciler calls is `OrgDomainProvisioner.provisionOrgDomain(...)`
(`apps/fleet-operator/src/cluster-tenants/internal/org-domain-provisioner.types.ts`), implemented by
`DefaultOrgDomainProvisioner` (`apps/fleet-operator/src/cluster-tenants/internal/org-domain.provisioner.ts`):
it **declares** the explicit `<org>.<base>` A record as a namespaced external-dns `DNSEndpoint` custom
resource (`externaldns.k8s.io/v1alpha1`); the external-dns controller reconciles it into whatever DNS
provider the platform runs (Cloud DNS, Route53, …) — no cloud SDK in the operator. When a `vanityDomain`
is set it additionally issues an HTTP-01 `Certificate` carrying the vanity SAN. Both side effects are
idempotent. It is **fail-closed + runtime-gated by real capability detection**: when the cluster has no
cert-manager and no external-dns, it returns `{ready:false, skipped:true}` and never crashes, while the
resource-authoring path stays real. The create path itself never mutates DNS or cert-manager — only the
reconciler (in the operator) does (fail-closed, API-first).

## Isolation Tiers

`ClusterTenantIsolationTier` (`libs/contracts/src/cluster-tenant.types.ts`) determines cluster placement:

| Tier | Cluster shape | Status |
|------|---------------|--------|
| `shared` | Namespace on bin-packed shared nodes; ResourceQuota caps the customer. | ✅ Built |
| `dedicatedNodes` | Namespace + a tainted node pool; operator stamps `nodeSelector`+`tolerations` (from `compute.mode=dedicated`, `compute.nodePool`). | ✅ Built |
| `dedicatedCluster` | Customer gets its own kube-apiserver via an **external provisioner** (webhook seam, AGPL-clean; Kamaji-shaped). | ⏸️ **Parked** — opencrane-api validates and rejects with `422 TIER_UNAVAILABLE` unless a provisioner is registered. |

The provisioner seam is a registry (`libs/backend/server/cluster-tenants/main/src/core/`) with a built-in shared provisioner plus an optional external webhook (`CLUSTER_TENANT_PROVISIONER_WEBHOOK_*`).

## Multi-Instance Cluster Shape

`multiInstance.enabled` flips these safety defaults (conformance-tested statically by `apps/_infra/deploy-k8s/platform/tests/multi-instance-conformance.sh`):

| Concern | Single-install | Multi-instance |
|---------|---------------|----------------|
| Operator/opencrane-api RBAC | `ClusterRole`/`ClusterRoleBinding` | namespaced `Role`/`RoleBinding` per instance |
| Operator watch scope | `WATCH_NAMESPACE=""` (all) | scoped + **fail-closed** if unset (`REQUIRE_WATCH_NAMESPACE`) |
| CRDs | installed with the release | installed once cluster-wide, `--skip-crds` on releases |
| cert Issuer / SecretStore | `ClusterIssuer` / `ClusterSecretStore` | namespaced `Issuer` / `SecretStore` |
| Cross-instance traffic | n/a | default-deny NetworkPolicy, same-instance allow only |

## Workload Identity

- **Cloud (GKE):** operator's SA carries `iam.gke.io/gcp-service-account: …`; GKE exchanges the projected K8s token for a GSA access token so the operator can provision GCS buckets without static creds. On-prem this is absent.
- **In-cluster (tenant pods):** up to three audience-bound projected SA tokens mounted read-only under `/var/run/opencrane/tokens/` — `aud=obot-gateway|feat-skill-registry|opencrane-server`, kubelet-rotated (`projectedTokenTtlSeconds`). Each receiving plane validates the audience via TokenReview. These tokens are never exposed to a browser.

## CRDs

Three CRDs are rendered from `apps/_infra/deploy-k8s/templates/crds/`, all in `opencrane.io`:

| CRD | Group | Scope |
|-----|-------|-------|
| `Tenant` (the **UserTenant**) | `opencrane.io` | Namespaced — the per-user OpenClaw agent-gateway. "UserTenant" is the canonical name; the CRD kind is still `Tenant`. |
| `AccessPolicy` | `opencrane.io` | Namespaced — egress/MCP/dataset policy. |
| `ClusterTenant` | `opencrane.io` | **Cluster-scoped** — the customer/isolation unit. |

All use `spec`/`status` subresources: spec is user/opencrane-api-owned, status is operator-owned.
