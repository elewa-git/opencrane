# @opencrane/backend/server/infra/agent-sandbox — Kubernetes sandbox realization

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › agent-sandbox

## What it owns

This package connects an admitted assistant conversation to its computer. The conversations backend
first records a lease: the computer identity, generation and expiry that may execute work. This
adapter asks Agent Sandbox to provide a Pod and checks that Kubernetes still reflects that lease.

```text
conversations backend ── admitted computer lease ──┐
                                                 ▼
                                  ┌────────────────────────┐
                                  │ agent-sandbox adapter  │
                                  └────────────────────────┘
                                                 │ claim + verified assignment
                                                 ▼
                                    Agent Sandbox controller ── computer Pod
```

**In this flow:** [conversations](../../conversations/main/README.md),
[Agent Sandbox deployment](../../../../../apps/_infra/agent-sandbox/README.md),
[conversation computer](../../../../../apps/conversation-computer/README.md).

A claim selects a release-owned computer template. Its status identifies a Sandbox; the adapter
reads that Sandbox, verifies its controlling claim's unique Kubernetes identifier, and checks the
Service address belongs to the same namespace. Missing assignment stays pending. Conflicting
identity or lease metadata fails closed.

## Public surface

- `AgentSandboxClaimAdapter` creates, observes, inspects, renews and releases claims. Renewal and deletion compare the observed Kubernetes identifier and resource version so they cannot modify a replacement or overwrite a concurrent change.
- `AgentSandboxPodBindingAdapter` reads the Pod named by the admitted claim and checks its namespace, name, unique identifier, service account and copied lease labels against the identity verified by Kubernetes TokenReview.

## Boundary

The conversations backend supplies authorised lease coordinates. This package translates the
pinned Agent Sandbox v0.5.3 API; it neither chooses profiles nor grants product permissions. It
accepts the controller's four known bookkeeping annotations while rejecting altered application
metadata. The Service address can appear before Pod readiness: the computer needs its active lease
to obtain the review credential that completes bootstrap.

## Dependency direction

This `scope:agent-sandbox`, `layer:infra` library uses the Kubernetes client and shared contracts.
It must not import application roots, backend domain implementations or frontend packages.

## Runtime & config

The server client needs claim create/get/patch/delete, Sandbox get and Pod get in the computer namespace.
It reads one named Pod; it cannot list, watch, create or delete Pods. Agent Sandbox retains Pod
ownership. A deleted Pod fails identity verification; Kubernetes permission and transport failures
reach the server diagnostic without exposing their response bodies.
The app-owned admission policy confines patches to lease extension or controller bookkeeping.
Shutdown times use the upstream controller's whole-second precision, rounded down from the admitted
expiry. Pods retain their separate workload-token verification; a Service address grants no authority.

## See also

- Parent index: [infra](../README.md)
- Workload identity: [workload-identity](../workload-identity/README.md)
