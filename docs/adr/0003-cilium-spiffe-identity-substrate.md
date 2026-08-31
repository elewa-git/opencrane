# ADR 0003 — Cilium identity and network-policy substrate

- **Status:** Accepted; corrected 2026-07-16 and 2026-08-31
- **Date:** 2026-07-02
- **Correction:** `#245` — separates Cilium security identity from optional SPIFFE/SPIRE identity
- **Supersedes / superseded by:** supersedes the earlier Linkerd substrate decision retained in
  version control
- **Related:** [ADR 0002](0002-per-clustertenant-silo-architecture.md) ·
  [`docs/agents/architecture.md`](../agents/architecture.md) ·
  [`docs/agents/k8s.md`](../agents/k8s.md)

## Context

The earlier substrate decision selected Linkerd while the platform still needed a portable standard
`NetworkPolicy` floor. The target platform instead requires a NetworkPolicy-enforcing CNI. Direct
Cilium installations can enforce that floor while adding identity-aware L3/L4 policy, L7 policy,
and FQDN egress.

A managed Cilium-based dataplane does not necessarily expose the Cilium policy APIs. GKE Dataplane
V2, for example, enforces standard `NetworkPolicy` but does not serve the namespaced
`CiliumNetworkPolicy` kind. OpenCrane therefore selects policy resources by the exact API and
enforcement capability, not by assuming that internal Cilium resource names imply a usable policy
controller.

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

### Standard policy is the baseline; Cilium policy is an extension

- Standard `NetworkPolicy` is the required default-deny L3/L4 floor on every supported cluster.
- The target platform may use Cilium as the enforcing CNI where the target cluster supports it.
  `CiliumNetworkPolicy` may add Cilium-specific selectors, L7 constraints, and FQDN egress only
  when the exact CRD and its enforcement controller are both present and qualified.
- A rule that needs only namespace labels, Pod labels, and ports stays a standard
  `NetworkPolicy`. Both generic and claimed warm-runtime profiles are such rules.
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
mutual authentication beyond the projected-token and network-policy baseline. That adoption requires
its own compatibility, failure-mode, rotation, observability, and operational gate. A future SVID
must not be treated as interchangeable with a Cilium identity or as business authorization.

### Cilium remains the preferred extended policy substrate

The supported platform always uses the standard `NetworkPolicy` floor. Direct Cilium installations
may add qualified Cilium policy features; managed Cilium-based platforms remain supported when the
OpenCrane workload class needs only the standard floor. Linkerd is not part of the runtime,
deployment, or compatibility contract.

## Alternatives considered

- **Cilium plus mandatory SPIRE from the first target slice** — rejected. It couples two distinct
  identity systems before a measured mutual-authentication need proves the additional control plane.
- **Linkerd as the permanent service mesh** — superseded. It would leave the target operating a
  second policy substrate beside the selected Cilium dataplane.
- **Standard `NetworkPolicy` only** — retained as the portable safety floor and the complete policy
  for workload classes that need only namespace, Pod-label, and port selection. It remains
  insufficient for a future workload that explicitly requires Cilium FQDN or L7 controls.
- **Business grants encoded in Cilium labels** — rejected. Those grants are dynamic,
  request-specific business facts owned by OpenCrane, not workload reachability facts.

## Consequences

- The identity model now has explicit, non-overlapping authorities: OpenCrane authorization,
  projected-token application authentication, Kubernetes RBAC, cloud IAM, and network-policy
  reachability, with optional Cilium extensions where qualified.
- Target-cluster qualification must prove live standard allow/deny enforcement. Any rendered
  Cilium policy additionally requires the exact served API and its enforcement controller; merely
  detecting a Cilium-based dataplane is insufficient.
- Target cluster choices must support the exact policy features rendered for each workload class.
  Superseded network-policy and mesh configuration is not supported.
- SPIRE/SVID work no longer blocks the network-policy baseline and cannot be smuggled in as an assumed
  synonym for Cilium identity.
