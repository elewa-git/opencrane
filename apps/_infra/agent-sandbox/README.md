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

The template fixes the conversation-computer image digest, RuntimeClass, service account, resources,
security context and static Pod metadata. It admits one exact copy of the server-issued computer id,
lease id and generation into `additionalPodMetadata`, then projects those Pod labels and fixes the
private server endpoint before the process starts. The claim policy permits
only the OpenCrane server identity to create the fixed v1beta1
claim shape, forbids claim environment variables and volume claims, limits dynamic Pod metadata to
those three values, and preserves those inputs across updates. The server may only extend the lease
expiry; the pinned controller may only update its four documented bookkeeping annotations.
After foreground deletion, the standard Kubernetes garbage-collector identity may remove its sole
`foregroundDeletion` finalizer while preserving the terminating claim's specification and metadata.
The server can read the claim's owned Sandbox for its service address, but cannot mutate that
Sandbox or its Pod. A mistake therefore denies activation instead of widening the Pod profile.

The release owns the computer's NetworkPolicy: the private server, LiteLLM and DNS are its only
outbound paths, and only the server can reach its review port. The template sets
`networkPolicyManagement: Unmanaged` so the upstream controller does not add its default public
internet access alongside that policy. Explicit `dnsPolicy: ClusterFirst` lets the computer resolve
the internal server and model service. The pinned controller otherwise replaces an omitted DNS
policy with public resolvers when its default managed policy applies. Changes to the template apply
to new claims; an existing Pod keeps its original DNS configuration.

The review credential uses the memory-backed `review-credential` volume at
`/var/run/opencrane/review`. Empty-directory volume names stay short enough for the gVisor mount
annotation keys generated from them. The rendered contract checks the Kubernetes 63-byte name
limit as well as the mount and its memory-backed storage, so an overlong internal name or a
mismatched credential mount fails validation before deployment.

## Public surface

`helm/templates/_resources.tpl` exports `opencrane.agentSandbox.resources`, which the silo umbrella
chart renders with its unchanged release context.

## Boundary

The chart creates release-scoped profiles, server claim RBAC and admission policy only. It never
installs Agent Sandbox CRDs or its controller, selects a Pod image at claim time, creates a bespoke
Pod controller, or keeps a legacy warm-runtime workload. The upstream controller and CRDs are external
cluster prerequisites. The core deploy action `--provision-agent-sandbox-controller --context CONTEXT`
delegates to `deploy-k8s/platform/deploy-agent-sandbox-controller.sh`. It installs the checksummed
v0.5.3 upstream manifest with the multi-platform controller image pinned by digest, and mounts
the fixed `opencrane.ai` allowlist from ConfigMap `opencrane-agent-sandbox-label-domains` at
`/etc/sandbox-config/allowed-label-domains`. The controller reads this file at startup. Its domain
allowlist permits propagation; the release policy still enforces the exact keys and lease values.
The action requires an explicit matching Kubernetes context and is separate from a silo Helm release.

## Dependency direction

An app entrypoint (`type:app`, `scope:agent-sandbox`) composed by `deploy-k8s`. It imports no app code
and owns no product authorization decision.

## Runtime & config

`agentSandbox.enabled` is false by default. Enabling it requires the pre-existing target namespace,
an installed `extensions.agents.x-k8s.io/v1beta1` API, a RuntimeClass, one service-account name, and
at least one named profile. Each profile requires a unique pool name, repository-and-`sha256` image
identity, pull policy, and CPU/memory requests and limits. Every resulting warm pool has
`replicas: 0`; claims start the configured profile only after the durable computer authority admits one.
The profile must set `warmReplicas: 0`. Nonzero values are rejected because the computer freezes its
lease coordinates at process startup, before an unused pool Pod could receive them.

The remote k3d smoke runs `tests/claim-admission-smoke.sh` against the installed policy. It waits for
current Kubernetes type checking, rejects expression warnings, and dry-runs a valid server claim
and forbidden identity, annotation, environment, lease and pool changes. Those requests persist no
claims or Pods. The following `tests/claim-lifecycle-smoke.sh` then persists a server-impersonated
claim in the disposable k3d cluster. It checks the controlling owner UID, Sandbox and Pod lease
labels, running Pod, cluster DNS, private server transport and same-namespace Service address. It
also rejects a controller-created template policy, then deletes that exact claim and waits for
foreground cleanup. It rejects other contexts. This proves controller reconciliation, without
claiming PostgreSQL admission, computer readiness or an assistant answer; live journeys prove those.

## See also

- Parent index: [_infra](../README.md)
- Silo chart: [deploy-k8s](../deploy-k8s/README.md)
- History ledger: [kurrentdb](../kurrentdb/README.md)
