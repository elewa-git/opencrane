# Identity and network isolation with Cilium and SPIFFE

Cilium and SPIFFE add **workload-identity-aware enforcement** above the portable
`NetworkPolicy` floor. This layer makes network decisions independent of Pod IP churn.

> See also: [Networking and isolation](/operators/networking) (portable floor),
> [Identity and runtime authentication](/security/identity) (application proof), and
> [Organisation boundary](/operators/organisation-boundary) (silo scope).

## Two identity systems

| Principal | Identity | Used for |
|---|---|---|
| Person | OIDC subject and session | Public UI and API authorisation |
| Workload | Kubernetes ServiceAccount and SPIFFE SVID | Mutual authentication between services |

Never translate a workload SVID into a person's authority. OpenCrane derives user and
organisation evidence from the admitted run, not from the runtime Pod.

## Silo identity

```text
spiffe://opencrane/ct/acme/opencrane
spiffe://opencrane/ct/acme/agent-controller
spiffe://opencrane/ct/acme/agent-runtime
```

Policy admits only named same-silo identities and explicitly required infrastructure. No rule
should admit a foreign organisation merely because it uses the same ports or labels.

## Defence in depth

| Layer | Role |
|---|---|
| Kubernetes `NetworkPolicy` | Namespace and port deny-by-default floor |
| SPIFFE mutual TLS | Cryptographic workload identity |
| Cilium policy | Identity-aware and optional FQDN/L7 restrictions |
| OpenCrane proof | Exact run, attempt, Job, Pod and revision authority |

The layers complement each other. A successful mTLS handshake does not authorise a run, and a
valid runtime assignment does not widen network policy.

## Egress

Runtime namespaces should reach only cluster DNS, same-silo OpenCrane, the release-local model
proxy and explicitly required managed services. Use Cilium FQDN rules when external HTTPS must
be narrowed beyond the portable TCP-port floor.

::: tip
Write negative tests first: foreign-silo, wrong-ServiceAccount and unlisted-host traffic should
all fail without relying on application response codes.
:::

## Rotation

SPIRE issues short-lived SVIDs from Kubernetes workload identity, so workloads do not carry a
manually distributed shared certificate. Rotation must preserve the trust domain and selectors
used by policy.
