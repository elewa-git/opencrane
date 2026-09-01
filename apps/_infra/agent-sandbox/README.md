# agent-sandbox — external Agent Sandbox profiles

> [apps](../../README.md) › [_infra](../README.md) › agent-sandbox

## What it owns

This deployment-only app translates each reviewed OpenCrane computer profile into one Agent Sandbox
`SandboxTemplate` and one zero-replica `SandboxWarmPool`. Agent Sandbox is an upstream Kubernetes
controller that creates the isolated Pod when OpenCrane later checks out a claim; this chart does not
install that controller or create Pods itself.

```
 OpenCrane server ── one checked claim ──► Agent Sandbox controller
       │                                      │ creates from fixed profile
       ▼                                      ▼
 claim Role + admission policy       SandboxTemplate ◄── HERE
                                             │
                                             ▼
                                  zero-replica SandboxWarmPool
```

**In this flow:** [deploy-k8s](../deploy-k8s/README.md) composes the resources; the external Agent
Sandbox controller reconciles the custom resources into Pods.

The template fixes the image digest, RuntimeClass, service account, resources, security context, Pod
metadata, and the ConversationComputer runtime bootstrap. The bootstrap contains the release-local
internal endpoint, one protocol revision, and a 10-minute projected Kubernetes service-account token
for that runtime route. The claim policy permits only the OpenCrane server identity to create the fixed
v1beta1 claim shape. It forbids claim environment variables, volume claims, every spec update, and
Pod metadata except the release selectors plus the checked computer id used by the runtime's
Downward API. A mistake therefore denies a computer activation instead of widening its Pod profile.
The server performs only claim-derived, name-bound reads of the assigned `Sandbox` and
backing `Pod`, so it can persist the controller-owned Pod UID on the durable computer lease; its
Role cannot list, watch, or mutate sandbox resources.

## Public surface

`helm/templates/_resources.tpl` exports `opencrane.agentSandbox.resources`, which the silo umbrella
chart renders with its unchanged release context.

## Boundary

The chart creates release-scoped profiles, server claim RBAC and admission policy only. It never
installs Agent Sandbox CRDs or its controller, selects a Pod image at claim time, creates a bespoke
Pod controller, or keeps a legacy warm-runtime workload. In standalone mode the explicit platform
bootstrap installs the pinned upstream controller and CRDs once for the cluster; a silo never owns
or upgrades those shared resources.

## Dependency direction

An app entrypoint (`type:app`, `scope:agent-sandbox`) composed by `deploy-k8s`. It imports no app code
and owns no product authorization decision.

## Runtime & config

`agentSandbox.enabled` is false by default. Enabling it requires the pre-existing target namespace,
an installed `extensions.agents.x-k8s.io/v1beta1` API, a RuntimeClass, one service-account name, and
at least one named profile. Each profile requires an immutable unique `profileRevisionId`, a unique
pool name, repository-and-`sha256` image identity, pull policy, and CPU/memory requests and limits.
`agentSandbox.runtime` pins the protocol revision and a token audience: the value the future server
route will check before accepting a projected Kubernetes token. The chart derives the internal endpoint
from the release's OpenCrane server Service, so a sandbox cannot select another server.
The umbrella chart mounts the resulting revision-to-profile map into the OpenCrane server as an
immutable ConfigMap, so durable activation events cannot select a different Sandbox profile. It also
creates an immutable bootstrap ConfigMap in the Sandbox namespace and projects a short-lived token at
`/var/run/secrets/opencrane/conversation-computer/token` without enabling the default Kubernetes token
mount. Every resulting warm pool has `replicas: 0`; claims start the configured profile only after the
durable computer authority admits one. The runtime cannot yet reach the internal listener: the later
authenticated runtime-route checkpoint adds the route and the matching NetworkPolicy rule after it can
bind this token to the computer, execution, lease, and exact Sandbox Pod.

## See also

- Parent index: [_infra](../README.md)
- Silo chart: [deploy-k8s](../deploy-k8s/README.md)
- History ledger: [kurrentdb](../kurrentdb/README.md)
