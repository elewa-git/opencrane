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

The template fixes the image digest, RuntimeClass, service account, resources, security context and
Pod metadata. The claim policy permits only the OpenCrane server identity to create the fixed v1beta1
claim shape, and forbids claim environment variables, volume claims, additional Pod metadata and every
spec update. A mistake therefore denies a computer activation instead of widening its Pod profile.

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
at least one named profile. Each profile requires a unique pool name, repository-and-`sha256` image
identity, pull policy, and CPU/memory requests and limits. Every resulting warm pool has
`replicas: 0`; claims start the configured profile only after the durable computer authority admits one.

## See also

- Parent index: [_infra](../README.md)
- Silo chart: [deploy-k8s](../deploy-k8s/README.md)
- History ledger: [kurrentdb](../kurrentdb/README.md)
