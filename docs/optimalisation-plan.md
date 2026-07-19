# Cluster optimisation plan

Purpose: reduce Kubernetes resource overhead on the OpenCrane dev cluster and define how the
platform stays efficient as tenant count grows. Captures the findings from the 2026-06-30
capacity investigation and records the networking/mesh decision (**upstream, self-managed Cilium
as the portable k8s-native dataplane — NOT a cloud-managed flavour; Linkerd deferred**).

Status: largely historical (June–July 2026). Phase 0 (dev resize) is done and the D1/D2
substrate decisions are executed (ADR 0003: upstream Cilium; Linkerd removed). The plane-pooling
and scale-to-zero phases (D4/D5) are deferred until measured target-workload evidence exists
(plan.md 2026-07-18 rebase, #136), and the per-silo plane tables below predate the
`feat-skill-registry` deletion.

---

## 1. Problem

The dev cluster (6 × `e2-medium`, 2 vCPU each → ~5.6 vCPU / 16.4 GiB allocatable) hit
`Insufficient cpu` scheduling failures — e.g. the OpenClaw gateway pod couldn't reschedule after an
idle-suspend without a cluster autoscale.

The cause is **over-reservation, not load**:

- **CPU requests ≈ 4.82 vCPU (86% of allocatable)** while **actual usage ≈ 0.69 vCPU (~12%)**.
- Memory: ~7.5 GiB actual of 16.4 GiB (~46%) — not the constraint, but several services request
  *less* than they use (eviction risk).

There are two distinct overheads, and they scale on different axes:

| Overhead | Magnitude | Scales with |
|---|---|---|
| **Per-node system tax** — `kube-proxy`, `fluentbit`, `kube-dns`, `node-local-dns`, CSI, `konnectivity`, metrics agents | **~2.34 vCPU (≈ half of all requests)** | **node count** |
| **Per-tenant plane duplication** — each silo runs a full `litellm`+`cognee`+`mcp-gateway`+`feat-skill-registry`+`clustertenant-manager`+Postgres | ~0.5 vCPU + ~1.5 GiB **× every tenant** | **tenant count** ← the real scale risk |

---

## 2. Findings — requests vs actual (per silo, identical across the three)

| Service | CPU req (was) | CPU actual | Mem req (was) | Mem actual | Issue |
|---|--:|--:|--:|--:|---|
| mcp-gateway | 250m | 34m | 256Mi | 116Mi | CPU ~7× over |
| clustertenant-manager | 100m | 2m | 128Mi | 135Mi | mem **under** (above its request) |
| cognee | 100m | 3m | 256Mi | 303Mi | mem **under** |
| litellm | 100m | 6m | 256Mi | **584Mi** | mem **way under** — OOM/eviction risk |
| feat-skill-registry | 100m | 1m | 128Mi | 71Mi | CPU over |
| db (CNPG) | none | 28m | none | 147Mi | unreserved |
| openclaw (agent) | none | 5m | none | 216Mi | unreserved; genuinely per-tenant |

Principle for right-sizing: **CPU is compressible** (throttle, not crash) → cut requests, keep
generous limits for burst. **Memory is not compressible** (under-request → OOMKill/eviction) →
raise requests to observed usage + headroom.

---

## 3. Decisions

### D1 — Upstream, self-managed Cilium is the dataplane (CHOSEN; vendor-neutral)

Adopt **upstream Cilium, installed and owned by the platform (Helm)**, as the networking + security
substrate on every hosting substrate. It is the single highest-leverage change because it solves
three problems at once:

1. **Removes `kube-proxy`** (eBPF service routing) → reclaims the ~0.6 vCPU per-node `kube-proxy`
   tax — the biggest slice of the per-node overhead.
2. **Enforces NetworkPolicy** → this cluster currently has **no enforcement engine**, so every
   `NetworkPolicy` (including the `openclaw-<tenant>-gateway` lockdown) is inert. Enforcement is the
   prerequisite that makes `gateway.controlUi.dangerouslyDisableDeviceAuth=true` safe — see
   **issue #105**. Cilium closes #105 directly.
3. **Identity-aware L3/4 (+ L7) policy and optional transparent encryption** (WireGuard/IPsec) —
   covers the "gateway reachable only via the operator proxy" requirement without a sidecar mesh.

**Why upstream Cilium and NOT GKE Dataplane V2:** Dataplane V2 is GKE-*managed* Cilium with a
GKE-specific control surface and a version you don't fully own — i.e. **cloud lock-in**, which
contradicts the self-hosted / data-sovereign posture and the `HostingAdapter` design (GCP is just
the first adapter). Upstream Cilium is CNCF-graduated and runs identically on GKE, EKS, AKS, on-prem,
and self-managed distros (kubeadm/Talos/k3s). The platform contract is therefore **"Cilium"**, not
"a cloud's managed networking", so the policy/identity model (`CiliumNetworkPolicy`, identity-aware
policy, encryption) is portable by construction. Install it through the platform's own install path
per substrate (alongside the cert-manager/CNPG install steps), not via a cloud add-on flag.

Trade-offs to plan for:
- **Operational ownership** — we install/upgrade Cilium ourselves (the cost of portability). Pin the
  version and roll it through the platform install path.
- **GKE friction** — GKE's *blessed* Cilium path is Dataplane V2; BYO upstream Cilium is cleanest on
  substrates where we control the CNI (EKS/AKS/on-prem/self-managed). On GKE we accept that friction
  rather than adopting the GKE-locked flavour as the standard. (As an in-place **stop-gap for #105
  only**, plain Calico `--enable-network-policy` can be toggled, but it neither removes `kube-proxy`
  nor matches the portable Cilium contract — it is not the target.)

### D2 — Linkerd removed

The dormant Linkerd mesh configuration was deleted with the Cilium replacement. Cilium is the sole
target workload-network substrate; future service-mesh work requires a new measured requirement and
must not restore a compatibility gate or sidecar path.

### D3 — Right-size resource requests (dev DONE; prod TODO)

Shipped: a `--dev-resources` deploy flag + `apps/_infra/deploy-k8s/values-dev.yaml` overlay
(**PR #109**) that cuts plane CPU requests and raises memory requests to observed usage.

| Plane | CPU req | Mem req |
|---|--:|--:|
| mcp-gateway | 250m → **75m** | 256Mi |
| clustertenant-manager | 100m → **50m** | 128Mi → **256Mi** |
| cognee | 100m → **25m** | 256Mi → **384Mi** |
| litellm | 100m → **25m** | 256Mi → **768Mi** |
| feat-skill-registry | 100m → **25m** | 128Mi |

Applied live to all three silos → cluster CPU requests **4.82 → 3.99 vCPU**. The flag fails fast if a
chart ships no overlay, so production never silently gets dev-sized requests. **Prod sizing is a
separate exercise** against real load (especially litellm/cognee).

### D4 — Stop duplicating planes per tenant (the scale architecture)

The per-ClusterTenant silo model (ADR 0002) gives every org a full private stack. At hundreds of
tenants that is hundreds of copies of services that need per-tenant *data/identity scoping*, not a
per-tenant *process*. Target architecture:

- **Share the stateless control/registry planes** across a pool: `litellm` (already issues
  per-tenant virtual keys — point them at one shared proxy), `mcp-gateway`, `feat-skill-registry`, and a
  namespace-scoped-but-shared operator + gateway-proxy (the operator already supports
  `WATCH_NAMESPACE`).
- **Pool the data plane** — one Postgres with per-tenant databases/schemas instead of a CNPG cluster
  per tenant.
- **Keep per-tenant only the `openclaw` agent pod** — it is genuinely single-occupant + owner-pinned.
- **Make the existing `shared` vs `dedicated` ClusterTenant tier mean something**: `shared` = pooled
  planes (cheap, default); `dedicated` = full silo (data-sovereignty/compliance premium). Today both
  get a full silo.

### D5 — Scale-to-zero the per-tenant agent

With D4, the only per-tenant cost left is the OpenClaw pod. Most tenants are idle most of the time:

- Idle auto-suspend exists (`IDLE_TIMEOUT_MINUTES`, default 30) — it scales the agent pod to zero.
- Add **wake-on-access**: `/auth/pod-token` (or `gateway-resolve`) detects a suspended/0-replica
  tenant, unsuspends it, and returns `409 POD_NOT_READY` → the SPA's existing "Setting up your
  workspace" provisioning loader (auto-poll) covers the ~1–2 min scale-up.
- Net cost ≈ **active** tenants, not total.

---

## 4. Roadmap (prioritised)

| Phase | Action | Outcome | Status |
|---|---|---|---|
| 0 | Right-size dev requests (`--dev-resources`, PR #109) | ~0.83 vCPU reclaimed cluster-wide | **done** |
| 1 | **Install upstream Cilium** via the platform install path (D1) | removes `kube-proxy` tax + enforces NetworkPolicy → closes #105; vendor-neutral | next |
| 2 | **Node consolidation** — fewer, bigger nodes (e.g. 2–3 × `e2-standard-4` vs 6 × `e2-medium`) | amortise per-node system tax | next |
| 3 | **Plane pooling + tiering** (D4) — `shared` tier shares planes | breaks the per-tenant duplication curve | design |
| 4 | **Scale-to-zero + wake-on-access** for agent pods (D5) | cost ≈ active tenants | design |

Phases 1 and 2 compound (tighter packing on fewer nodes) and are the cheapest near-term wins; 3 and
4 are the structural changes that matter most as tenant count grows.

---

## 5. Cross-references / open items

- **#105** — enable NetworkPolicy enforcement (resolved by D1/Phase 1). The `openclaw-<name>-gateway`
  netpol selector is already fixed (`clustertenant-manager`), so the policy is correct and ready.
- **#109** — the `--dev-resources` profile (D3).
- **Deploy hygiene — ingress fold DONE.** `helm upgrade` used to hit SSA conflicts because the
  same-origin ingress rules were patched out-of-band (weownai `deploy-org-frontend.sh` for the org
  host, `platform/deploy.sh` for the fleet host), so the `kubectl-patch` field manager owned
  `.spec.rules` and Helm refused to overwrite. Both are now Helm-owned:
    - the **fleet** host was already folded — `fleet-manager-ingress.yaml` renders `/api` + `/auth`
      unconditionally (the SPA's own Ingress owns `/`);
    - the **org** host is now folded behind an opt-in `ingress.sameOrigin` (default OFF → the
      historical `/`→opencrane-api render is byte-identical). Set `ingress.sameOrigin.enabled=true`
      on the silo chart and Helm renders `/api` + `/gateway` + `/`→SPA natively.
    - both weownai deploy scripts' kubectl patches are now **idempotent** — they skip when the
      ingress already carries `/api` (chart-owned) and only fall back to a patch on the legacy
      layout, so they no longer re-assert a field manager over Helm.
  One-time migration for a silo whose ingress is still owned by the old `kubectl-patch` field
  manager: run a single `helm upgrade --force` (or `kubectl … apply --server-side --force-conflicts`)
  with `ingress.sameOrigin.enabled=true` to hand ownership back to Helm; every subsequent upgrade is
  then clean.
- **Deploy hygiene — feat-skill-registry env (resolved, #134/#140).** The out-of-band writer was the
  operator's `RuntimePlaneDriftRepairer`, whose client-side apply landed as the `node-fetch` field
  manager and contested Helm's ownership. #140 deleted it; `CONTROL_PLANE_URL`, `PORT`, and the
  observability env are all rendered by `feat-skill-registry-deployment.yaml`, so a plain `helm upgrade`
  no longer reverts the plane's env. (`k8s-deploy.sh` also runs `--force-conflicts` so a one-time
  recreate clears any stale `node-fetch` ownership left on a live silo — #146.)
- **Suspend self-loop (resolved, #134).** The suspend path now carries an `observedGeneration` guard
  (mirroring `reconcileTenant`): it stamps `observedGeneration` on the Suspended status and skips a
  Modified event that matches it, so the operator no longer re-processes its own suspend write.
- **Operator auto-reconcile on config change (resolved, #134).** The reconcile guard now also
  compares an `_OperatorConfigChecksum` (stamped as `observedConfigChecksum`); a `helm upgrade` that
  changes operator config re-arms a full reconcile of every tenant without a manual restart or
  per-tenant spec edit — the operator-input analogue of the tenant-pod config-checksum roll.

---

## 6. Non-goals (for now)

- **Production resource sizing** — `values-dev.yaml` is dev-only; size prod to measured load.
