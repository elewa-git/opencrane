# Identity and network isolation with Cilium

Cilium can add **workload-identity-aware enforcement** above the portable `NetworkPolicy` floor.
SPIFFE/SPIRE remains an optional future identity layer, not a requirement for OpenCrane's current
projected-token and network-policy boundary.

> See also: [Networking and isolation](/operators/networking) (portable floor),
> [Identity and runtime authentication](/security/identity) (application proof), and
> [Organisation boundary](/operators/organisation-boundary) (silo scope).

## Two identity systems

| Principal | Identity | Used for |
|---|---|---|
| Person | OIDC subject and session | Public UI and API authorisation |
| Workload | Kubernetes ServiceAccount and projected token | Receiver-verified application authentication |
| Optional workload identity | SPIFFE SVID | Future mutual authentication where separately qualified |

Never translate a workload token or future SVID into a person's authority. OpenCrane derives user
and organisation evidence from the admitted run, not from the runtime Pod.

## Policy capability

```text
standard NetworkPolicy
  └── namespace + Pod labels + ports

CiliumNetworkPolicy, when the exact API and controller exist
  └── optional Cilium-specific identity, FQDN and L7 controls
```

OpenCrane renders standard policy for the warm-runtime profiles because they need only namespace,
Pod-label and port selection. A managed Cilium-based dataplane may enforce that floor without
serving Cilium's namespaced custom policy kind. GKE Dataplane V2 is one such platform.

::: warning
Do not infer policy support from the presence of unrelated `cilium.io` resources. Before rendering
a Cilium-specific policy, prove that the exact kind is served and that its controller enforces it.
Installing a CRD without the controller creates no network boundary.
:::

## Defence in depth

| Layer | Role |
|---|---|
| Kubernetes `NetworkPolicy` | Namespace and port deny-by-default floor |
| Projected ServiceAccount token | Receiver-verified workload authentication |
| Cilium policy, where qualified | Optional identity-aware FQDN/L7 restrictions |
| OpenCrane proof | Exact run, attempt, Job, Pod and revision authority |

The layers complement each other. A valid workload token does not authorise a run, and a valid
runtime assignment does not widen network policy.

## Egress

Runtime namespaces should reach only cluster DNS, same-silo OpenCrane, the release-local model
proxy and explicitly required managed services. Use Cilium FQDN rules when external HTTPS must
be narrowed beyond the portable TCP-port floor.

::: tip
Write negative tests first: foreign-silo, wrong-ServiceAccount and unlisted-host traffic should
all fail without relying on application response codes.
:::

## Optional SPIFFE/SPIRE

SPIRE can issue short-lived SVIDs from Kubernetes workload identity when a measured mutual-
authentication requirement justifies that extra control plane. Adoption requires separate
compatibility, failure-mode, rotation and observability qualification. An SVID never replaces
OpenCrane's product authorization or becomes a Cilium security identity automatically.
