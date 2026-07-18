# Kubernetes & Cluster Security

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.
>
> These are the operational Kubernetes rules that implement the identity philosophy in
> [`architecture.md`](./architecture.md). Helm/Terraform ownership of these resources is described
> in [`infra.md`](./infra.md).

> **Full cluster topology** — physical cluster, Helm template inventory, plane wiring, namespace
> model, network topology, isolation tiers, and multi-instance shape — is in
> [`cluster-architecture.md`](./cluster-architecture.md). This file covers the coding rules and the
> operator's runtime behaviour.
>
> **Tenancy terms** — a **ClusterTenant** is the customer/isolation unit that owns a namespace, quota,
> and its own base domain; a **UserTenant** is the per-user OpenClaw agent gateway (the `Tenant`/openclaw
> CRD, kind still `Tenant` in code) that runs inside that namespace and is exposed at one host under the
> ClusterTenant's domain. Defined authoritatively in
> [`cluster-architecture.md` → Tenancy Model](./cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant).

## Cluster Architecture Context

How the operator actually shapes the cluster (verified June 2026):

- **Three CRDs** in `apps/_infra/deploy-k8s/templates/crds/`: `Tenant`, `ClusterTenant`
  (cluster-scoped), and `AccessPolicy`. CRDs use `spec`/`status` subresources — spec is
  user/opencrane-api-owned and status is operator-owned (patched via `*StatusWriter` /
  `patchNamespacedCustomObjectStatus`). MCP servers, skills, and schedules are API/Postgres domains,
  not CRDs.
- **The current operator reconcile is an idempotent ~10-step sequence per UserTenant** (`Tenant` CR, `libs/backend/feat-openclaw-tenant/main/src/reconcilers/tenants/operator.ts` — the in-silo controller runs in each silo over its OWN namespace): resolve parent ClusterTenant → enforce isolation (PSA labels + ResourceQuota + LimitRange) → resolve effective AccessPolicy (precedence: explicit `policyRef` > selector > default > none) → ServiceAccount (+ Workload Identity annotation on GKE) → external storage → per-UserTenant AES-256 key Secret → LiteLLM virtual key (best-effort) → ConfigMap → state volume → single-replica Deployment + Service + Ingress → patch status. **All applies are server-side (fieldManager `openclane-operator`)** so re-runs are safe. This OpenClaw-specific controller is a deletion target; do not extend it for the replacement runtime.
- **Watch loop auto-reconnects** with 5s backoff (`shared/watch-runner.ts`); the K8s API closes streams every ~5–10 min — treat reconnects as normal, never as an error path.
- **Namespace isolation is enforced per-ClusterTenant**: PSA *baseline* profile labels (not *restricted* — silos run 3rd-party planes like Obot's embedded root Postgres, Cognee-as-root, and Langfuse subcharts that can't meet *restricted*; *baseline* still blocks privileged containers, host namespaces, `hostPath`, and host ports; tightening is a tracked security follow-up), a `ResourceQuota` (cpu/mem/pods/storage/gpu), and a `LimitRange` (per-container defaults — required because the quota constrains `requests.*`). Pod placement: `nodeSelector` + `tolerations` are stamped only when the parent's `compute.mode = dedicated`; shared mode is left unconstrained (byte-for-byte baseline preserved).
- **Delete is non-destructive for data**: removing a UserTenant (`Tenant` CR) deletes Deployment/ConfigMap/Service/Ingress/PVC but **retains GCS buckets and the encryption-key Secret**. Suspend (`spec.suspended=true`) scales to 0 replicas and keeps all state.
- **`PolicyOperator`** builds a standard `NetworkPolicy` (CIDR + port egress, DNS always allowed first) from each AccessPolicy, plus an optional `CiliumNetworkPolicy` for FQDN/domain filtering — Cilium apply failures are logged and skipped gracefully (standard NetworkPolicy still applies).

### Ingress hosts & DNS hierarchy

The cluster routes **two public host shapes** — the platform opencrane-api host and org hosts (full
model in [`cluster-architecture.md` → Tenancy Model](./cluster-architecture.md#tenancy-model--clustertenant-vs-usertenant)):

```
platform.weownai.eu          → control plane (platform management API)   [fixed super-operator host]
acme.weownai.eu              → org "acme" — UI, /api/*, gateway WebSocket [org host, explicit A record]
  (all acme users connect here; identity-routing proxy routes each to their pod)
```

- The operator emits an **explicit `<org>.<base>` A record** as an external-dns `DNSEndpoint` at org
  provision time. There are **no per-user Ingress objects** — the operator no longer builds one Ingress
  per UserTenant.
- A **single wildcard Ingress** at `*.<base>` path-routes `/api` to the control plane and the gateway
  WebSocket path to the operator's identity-routing proxy Service.
- cert-manager issues `*.<base>` + apex + opencrane-api host (`cluster-issuer.yaml`). The wildcard
  covers every org host `<org>.<base>`. A per-org HTTP-01 cert is issued only when `vanityDomain` is set.
- The **control plane's own host is not wired by an Ingress in the chart** today: routing
  `platform.<base>` to the opencrane-api Service is an installer/out-of-chart step.
- The per-pod gateway NetworkPolicy admits the gateway port only from the operator pods (which host
  the proxy). UserTenant pods are not reachable directly from the ingress controller.

## Defaults

- New services should get a dedicated Kubernetes service account.
- New services should get a dedicated cloud service account when they need cloud API access.
- Disable service account token automount unless Kubernetes API access is explicitly required.
- Scope IAM and RBAC to the smallest role that satisfies the workload.
- Prefer machine-to-machine identity over shared secrets.

## Internal Routes Without Auth Middleware

When a route is intentionally excluded from `___AuthMiddleware` and relies on Kubernetes NetworkPolicy for access control instead, the router function must:

1. State this explicitly in its JSDoc with a bolded note.
2. Include a `@see` tag pointing to the Helm NetworkPolicy template that enforces the restriction.
3. Include a second `@see` pointing to the deployment template that wires the caller.

```typescript
/**
 * Internal router for widget delivery.
 *
 * **This router is NOT behind `___AuthMiddleware`.**
 * Access is enforced by Kubernetes NetworkPolicy.
 *
 * @see apps/opencrane/helm/templates/_networkpolicy.tpl — policy restricting
 *   which pods can reach the opencrane-api service.
 * @see apps/_infra/deploy-k8s/templates/feat-skill-registry-deployment.yaml — current caller
 *   that sets the control-plane internal URL.
 */
export function _RegisterInternalWidgets(prisma: PrismaClient): Router { ... }
```

> Network reachability does not imply authorization — see
> [OpenCrane-Specific Direction](./architecture.md#opencrane-specific-direction).

The plane-to-plane boundary is split by owner: `apps/opencrane/helm/templates/_networkpolicy.tpl`
protects the server's public and internal listeners; `apps/_infra/obot/helm/templates/_networkpolicy.tpl`
protects the MCP gateway; `apps/artifact-service/helm/templates/_resources.tpl` separately restricts
the ArtifactStore byte service to the OpenCrane server across its dedicated sibling namespace. Because `/api/internal/*` has no auth
middleware, the server NetworkPolicy is the **only** boundary protecting it — path-based filtering
is impossible, so never widen these selectors casually.

## Workload Identity & Projected Tokens

- **Cloud identity (GKE):** the current tenant operator stamps the KSA annotation `iam.gke.io/gcp-service-account: openclaw-{tenant}@{project}.iam.gserviceaccount.com`; the reusable hosting adapter lives under `libs/server/_infra/tenant-hosting/src/adapters/gcp/`. The GSA↔KSA IAM binding is set up outside the operator (Terraform). On-prem the annotation is empty and storage provisioning is a no-op. The replacement runtime must use its target identity model directly rather than preserve this OpenClaw-shaped identity.
- **In-cluster identity:** UserTenant (OpenClaw) pods mount up to three audience-bound projected SA tokens read-only under `/var/run/opencrane/tokens/` — `obot-gateway.token`, `feat-skill-registry.token`, `opencrane-server.token`. TTL is `projectedTokenTtlSeconds` (env-driven); kubelet rotates them with no pod restart. These are real and actively consumed, not aspirational.
- **`WATCH_NAMESPACE` fail-closed:** with `multiInstance.requireWatchNamespace=true` the operator refuses to start if `WATCH_NAMESPACE` is unset — prevents one instance from reconciling another's UserTenants. Empty means watch-all (legacy single-install only).
