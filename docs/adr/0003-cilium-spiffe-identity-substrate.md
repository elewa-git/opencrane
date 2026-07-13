# ADR 0003 — Cilium + SPIFFE identity substrate

- **Status:** Accepted
- **Date:** 2026-07-02
- **Task:** platform-direction decision (2026-07-02) — fires the reserve trigger ADR 0001 left open
- **Supersedes / superseded by:** supersedes [ADR 0001](0001-cluster-tenant-virtual-network-isolation.md)
- **Related:** [`silo-multi-tenant-plan.md`](../../silo-multi-tenant-plan.md) (§2 identity loop — this ADR realigns the decision with that plan's original OIDC→opencrane-server→operator→Cilium/SPIFFE phrasing) · [`docs/adr/0002`](0002-per-clustertenant-silo-architecture.md) (the silo architecture this substrate secures) · [`website/operators/networking.md`](../../website/operators/networking.md) · the reader-facing identity model at `website/security/identity.md` + `website/operators/cilium-spiffe-identity.md`

## Context

ADR 0001 chose **Linkerd** as the workload-identity + L7 substrate and **explicitly held
Cilium/SPIFFE in reserve** behind a stated trigger: *"we need full `CiliumNetworkPolicy` +
SPIFFE, and we are willing to leave GKE Autopilot and run our own CNI."* That trigger has now
fired. The platform is standardising on a single, identity-first dataplane that expresses
L3/L4 **and** L7 **and** cryptographic workload identity in one model, and it accepts running
its own CNI as the price of a portable, cloud-neutral substrate.

Two facts pushed the decision:

1. **The Linkerd slice was code-ready but never installed, and it is a *second* system.**
   Linkerd gives mTLS identity + L7 authorization, but it rides *on top of* a separate
   standard-`NetworkPolicy` floor — two identity models (mesh SVID vs. namespace/IP), two
   failure domains, two things to reason about. It does not give identity-keyed L3/L4 or
   FQDN egress in one place.
2. **The org is going k8s-native and identity-first.** One dataplane that keys every
   decision — packet-level and request-level — on cryptographic **workload identity** (not IP,
   not namespace position) is the cleaner long-term substrate, and it matches the identity loop
   the original silo plan described before ADR 0001 narrowed it.

## Decision

### Substrate = Cilium (eBPF dataplane) + SPIFFE/SPIRE workload identity

- **One dataplane, identity-keyed, L3→L7.** `CiliumNetworkPolicy` expresses default-deny
  east-west, per-silo isolation, and per-route (L7) authorization — all keyed on **Cilium
  security identities** derived from workload identity, not on pod IPs. Standard
  `NetworkPolicy` is subsumed: Cilium enforces it too, so the portable L3/L4 floor from S2
  keeps working while `CiliumNetworkPolicy` adds identity + L7 + FQDN egress on the same engine.
- **Workload identity via SPIFFE.** Each meshed workload is issued a **SPIFFE SVID**
  (`spiffe://opencrane/ct/<org>/<workload>`) bound to its Kubernetes ServiceAccount by SPIRE,
  and used for mutual TLS (Cilium mutual authentication) between silo workloads. Identities are
  short-lived, auto-rotating, and churn-robust — no shared secret, no IP allow-list to drift.
- **Human identity stays Zitadel OIDC (per-org), unchanged.** Human and workload identity meet
  only at OIDC-guarded opencrane-server hops via token-exchange; the crown-jewel super-admin
  (opencrane-server/operator) identity remains the **only** cross-silo principal, now enforced by
  Cilium identity at L3/L4 **and** L7.

### Rollout is additive

The per-silo default-deny floor stays in place throughout. A silo gains identity/L7 isolation
incrementally as its workloads are issued SVIDs and its `CiliumNetworkPolicy` set is tightened
— there is no window where a silo is *less* isolated than the S2 floor.

### Substrate scales with `isolationTier`

| Tier | Substrate |
|------|-----------|
| `shared` | Cilium CNI + `CiliumNetworkPolicy` + SPIFFE identity & L7, one cluster |
| `dedicatedNodes` | same as `shared`, pinned to dedicated nodes |
| `dedicatedCluster` | vcluster / Kamaji — a separate control plane per silo (strongest isolation) |

## Alternatives considered

- **Linkerd service mesh (ADR 0001's choice)** — reconsidered and **superseded**. mTLS identity
  + L7 authorization with less operational surface, and it kept GKE Autopilot viable. But it is
  a *second* system layered on a separate `NetworkPolicy` floor: two identity models, two
  failure domains, and no identity-keyed L3/L4 or first-class FQDN egress. We chose one
  identity-first dataplane over two composed systems.
- **Standard `NetworkPolicy` only** — the live S2 L3/L4 floor. Portable but not
  identity-aware, no L7, no mTLS. Retained as the floor, now enforced *by Cilium*.
- **vcluster / Kamaji per silo** — strongest isolation (a separate control plane per silo).
  **Reserved for the `dedicatedCluster` tier** and the AGPL / WeOwnAI enterprise seam; kept an
  arm's-length provisioner, not the default substrate.
- **Istio (ambient or sidecar)** — comparable L7 identity authorization; heavier to run than
  the eBPF path for the posture we need. Not chosen.

## Consequences

- **Single identity-first model.** One substrate keys L3/L4/L7 and mTLS on the SPIFFE workload
  identity — the same principal everywhere, packet to request. Simpler to reason about and to
  audit than two composed systems.
- **New operational dependency + Autopilot exit.** The cluster now runs **Cilium as its CNI**
  and **SPIRE** for SVID issuance. This is exactly the ops cost ADR 0001 flagged and deferred;
  we accept it in exchange for the identity-first, cloud-neutral posture. GKE Autopilot's
  managed-CNI-only mode is no longer assumed for the shared/dedicated-node tiers.
- **FQDN egress becomes first-class.** `CiliumNetworkPolicy` `toFQDN`/`toDNS` rules give
  per-silo egress allow-lists by hostname (e.g. only the model provider), replacing the
  previously-deferred FQDN egress control.
- **Portable across conformant Kubernetes that can run Cilium.** The only hard dependency is
  "a cluster where we control the CNI" — available on GKE Standard, EKS, AKS, and self-hosted.
- **Implementation is forward work.** This ADR records the *decision*. The gated Linkerd slice
  (`LINKERD_MESH_ENABLED`, `silo-linkerd-identity.ts`) is retired in favour of SVID issuance +
  `CiliumNetworkPolicy` generation by the operator. The S2 `NetworkPolicy` floor is unchanged
  and remains the safety net until the Cilium/SPIFFE layer is enforcing in every silo. The build
  and the Linkerd removal are tracked in
  [italanta/opencrane#117](https://github.com/italanta/opencrane/issues/117).
- **The crown jewel is unchanged and reinforced.** Super-admin remains the only cross-silo
  identity; making its SVID issuance, rotation, and audit correct is now the most load-bearing
  security task on the platform.
