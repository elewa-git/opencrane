# ADR 0003 — Cilium identity and network-policy substrate

- **Status:** Accepted; corrected 2026-07-16
- **Date:** 2026-07-02
- **Correction:** `#245` — separates Cilium security identity from optional SPIFFE/SPIRE identity
- **Supersedes / superseded by:** supersedes the Linkerd substrate decision in
  [ADR 0001](0001-cluster-tenant-virtual-network-isolation.md)
- **Related:** [ADR 0002](0002-per-clustertenant-silo-architecture.md) ·
  [`docs/agents/architecture.md`](../agents/architecture.md) ·
  [`docs/agents/k8s.md`](../agents/k8s.md)

## Context

ADR 0001 selected Linkerd over Cilium while the platform still needed a portable standard
`NetworkPolicy` floor. The later platform direction selected Cilium as the enforcing CNI for the
target architecture because it can enforce that floor while adding identity-aware L3/L4 policy,
L7 policy, and FQDN egress.

The original version of this ADR incorrectly described Cilium identity and SPIFFE/SPIRE identity as
one substrate. They are different mechanisms:

- Cilium assigns numeric security identities from identity-relevant Kubernetes labels. A workload's
  namespace, application labels, and Kubernetes ServiceAccount labels can therefore select network
  policy without using a SPIFFE ID.
- SPIRE issues cryptographic SPIFFE Verifiable Identity Documents (SVIDs). An SVID is not a Cilium
  security identity and does not automatically become one.
- Cilium mutual authentication may integrate with SPIRE, but that optional feature has separate
  operational and compatibility limits. It is not required for Cilium policy enforcement.

The distinction matters because OpenCrane already has explicit application identity: audience-bound
projected Kubernetes ServiceAccount tokens are validated by the receiving workload, Kubernetes RBAC
governs Kubernetes API access, and cloud Workload Identity governs cloud API access. Network policy
must reinforce those boundaries rather than claim to replace them.

## Decision

### Cilium label-derived identities are the baseline

- The green platform uses Cilium as the enforcing CNI where the target cluster supports it.
- Standard `NetworkPolicy` remains the portable default-deny L3/L4 floor. `CiliumNetworkPolicy`
  adds ServiceAccount/application-label selection, L7 constraints, and FQDN egress.
- Cilium identities represent stable workload properties such as namespace, application, and
  ServiceAccount. They do not encode organization, department, team, user, project, direct share,
  or other business grants.
- Cilium controls reachability. The OpenCrane authorization layer and each enforcement point still
  validate the request's user/run/resource/action authority. Network location is not authorization.

### Workload authentication remains explicit

- In-cluster application authentication uses narrowly projected, audience-bound Kubernetes
  ServiceAccount tokens with receiver-side validation where that established pattern applies.
- Kubernetes RBAC answers only which Kubernetes API operations a ServiceAccount may perform.
- Cloud Workload Identity answers only which cloud APIs a workload may access.
- Default ServiceAccount token automount remains disabled unless Kubernetes API access is required.

### SPIFFE/SPIRE is optional later work

SPIRE may be introduced later if a measured requirement needs cryptographic workload identity or
mutual authentication beyond the projected-token and Cilium-policy baseline. That adoption requires
its own compatibility, failure-mode, rotation, observability, and operational gate. A future SVID
must not be treated as interchangeable with a Cilium identity or as business authorization.

### Linkerd is frozen blue, not a target dependency

The existing dormant/frozen-blue Linkerd surface may remain only for the signed blue rollback
manifest. Phase A inventories and freezes those references. Green adds no Linkerd dependency;
replacement and deletion occur only after the Cilium/default-deny target is enforcing at the R9/R10
gates. Removing blue Linkerd before its replacement is proven would weaken the rollback contract.

## Alternatives considered

- **Cilium plus mandatory SPIRE from the first green slice** — rejected. It couples two distinct
  identity systems before a measured mutual-authentication need proves the additional control plane.
- **Linkerd as the permanent service mesh** — superseded. It would leave the target operating a
  second policy substrate beside the selected Cilium dataplane.
- **Standard `NetworkPolicy` only** — retained as the portable safety floor, but insufficient for
  the target's FQDN and identity-aware policy requirements.
- **Business grants encoded in Cilium labels** — rejected. Those grants are dynamic,
  request-specific business facts owned by OpenCrane, not workload reachability facts.

## Consequences

- The identity model now has explicit, non-overlapping authorities: OpenCrane authorization,
  projected-token application authentication, Kubernetes RBAC, cloud IAM, and Cilium reachability.
- Green cluster qualification must prove Cilium agent/operator readiness and live allow/deny
  enforcement before cutover; policy application is not best effort.
- Cluster choices for green must support the required Cilium mode. Existing blue topology remains
  governed by its frozen release contract until per-silo replacement.
- SPIRE/SVID work no longer blocks the Cilium baseline and cannot be smuggled in as an assumed
  synonym for Cilium identity.
