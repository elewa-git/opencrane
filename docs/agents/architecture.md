# Platform Architecture & Identity

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.
>
> This file holds the platform's identity *philosophy*. The operational Kubernetes rules that
> implement it live in [`k8s.md`](./k8s.md); the Terraform/Helm split that defines it lives in
> [`infra.md`](./infra.md).

## Platform Topology

The non-obvious shape of the system (verified June 2026). Read this before touching tenancy, auth, or cross-service flow.

**Tenant model is a two-tier hierarchy** (canonical definition in
[`cluster-architecture.md` → Tenancy Model](./cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant)):

- **ClusterTenant** (cluster-scoped CRD `clustertenants.opencrane.io`, **optional** parent) — the first-class *customer* / isolation unit. Carries `isolationTier`, compute mode, resource quota, and its own base domain; binds a namespace (`status.boundNamespace`).
- **UserTenant** (namespaced CRD, always exists) — **is** the per-user OpenClaw agent-pod definition (one pod per UserTenant), exposed at `<user>.<clustertenant-domain>`. "UserTenant" is the canonical doc name; the CRD kind is still `Tenant` in code. There is no separate "openclaw" CRD; "OpenClaw" is the pod runtime.
- A UserTenant *without* `clusterTenantRef` deploys into the install namespace (single-install legacy mode). *With* a ref, the operator resolves the parent ClusterTenant's bound namespace and applies its isolation policy.
- `isolationTier` ∈ `shared` (bin-packed nodes) · `dedicatedNodes` (tainted node pool) · `dedicatedCluster` (own kube-apiserver via external provisioner). Enum: `ClusterTenantIsolationTier` in `libs/contracts/src/cluster-tenant.types.ts`.

**Five planes** (each detailed in [`app-specific.md`](./app-specific.md)):

| Plane | Role | Talks to |
|-------|------|----------|
| **opencrane-api** | API-first management surface (`/api/v1`), OIDC broker, source of truth for Tenants/AccessPolicies/Grants/MCP/Skills. Dual-writes CRDs + Postgres. | everything |
| **operator** | Reconciles UserTenant (`Tenant`)/ClusterTenant/AccessPolicy CRs → namespaces, pods, Ingresses, NetworkPolicies, buckets. | Kubernetes API |
| **Obot MCP gateway** | MCP credential custody and tool-execution PEP. OpenCrane owns catalog and grants; tenant pods reach MCP servers *through* Obot. | tenant pods, MCP workloads |
| **feat-skill-registry** | Entitlement-gated skill-bundle delivery; validates pod identity via TokenReview, proxies to opencrane-api. Non-entitled → **404** (existence-hiding). | opencrane-api, tenant pods |
| **feat-central-agents** | Background ingestion worker (Slack connector → Postgres `OrgDocument`). Not API-first. | external sources, Postgres |

**Identity is multi-credential**, with non-interchangeable purposes: (1) OIDC session cookie for
human operators, (2) **projected SA tokens** for in-cluster workloads (audience-bound:
`aud=obot-gateway|feat-skill-registry|opencrane-server`, short-lived and rotated, never handed to a
browser), and (3) static `OPENCRANE_API_TOKEN` as an explicit automation/break-glass migration
target. The temporary `POST /api/v1/auth/pod-token` connection-preflight route resolves the tenant
**solely from the verified session email** (fail-closed `409 AMBIGUOUS_TENANT`) and returns connection
coordinates, not a pod or gateway credential. It expires at that silo's R9 cutover.

**Two facts that catch agents out:**

- **`___AuthMiddleware` does NOT enforce per-route roles today** (`libs/infra/auth/src/auth-middleware.ts`). It's a fallback chain: public paths → OIDC cookie → env token → DB access token → dev bypass. Role/capability claims are a *planned* target — do not assume RBAC at the route layer.
- **State is dual-written: CRD is source of truth, Postgres is a projection.** Every Tenant/AccessPolicy mutation hits both. Drift between them is expected and has explicit tooling (`GET /tenants/drift`, `POST /tenants/repair`, projection-drift metrics). Don't "fix" a divergence by writing only one side.

**Effective contract:** each tenant's entitlements compile into one SHA256-keyed JSON blob (`GET /:name/effective-contract`) covering awareness datasets + MCP servers + skill bundles. Tenant pods re-pull it on a ~30s loop; on `contractId` change the pod gets a SIGHUP + a re-rendered config. This is the runtime authorization mechanism — changing a grant is not effective until the contract recompiles and the pod re-pulls.

## IAM-First

OpenCrane is IAM-first.

- Prefer federated identity, Workload Identity, OIDC, and cloud IAM over static bearer tokens.
- Treat bearer tokens as temporary compatibility shims or break-glass paths, not the default architecture.
- Every platform service and every tenant workload should have an explicit workload identity.
- Every human operator should authenticate through centrally managed identity, not shared long-lived tokens.

## Central Identity Model

Identity and authorization must be described centrally.

- Cloud IAM is the source of truth for cloud resource access.
- Kubernetes RBAC is the source of truth for Kubernetes API access.
- Terraform should define cloud identities, trust bindings, and IAM role attachments.
- Helm should define Kubernetes service accounts, RBAC bindings, and workload identity annotations.
- Application code should consume identity provided by the platform rather than inventing parallel auth schemes.

## Token Policy

- Do not introduce new bearer-token control paths when IAM or OIDC can solve the problem.
- Existing bearer-token paths should be treated as migration targets.
- If a bearer token is unavoidable, document why IAM cannot be used, constrain its scope, and define a removal path.

## OpenCrane-Specific Direction

- Tenant workloads should use per-tenant Workload Identity for cloud storage and other tenant-scoped cloud resources.
- Operator and opencrane-api services should move toward explicit workload identities instead of implicit cluster-only trust.
- Network reachability does not imply authorization; authorization should come from IAM and RBAC, not location on the cluster network.
