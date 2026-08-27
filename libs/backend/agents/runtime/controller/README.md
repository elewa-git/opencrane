# @opencrane/backend/agents/runtime/controller — AgentRun Job operations

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › controller

## What it owns

This package contains the Kubernetes operations used by the AgentRun workflow handler. A workflow is
durable background work: OpenCrane saves the task with the run, and the controller can resume it
after a restart. The server chooses the runtime profile and records the Job and Pod identities; this
package creates or adopts that exact suspended Job, creates its one key Secret, releases it, and
finds its first Pod.

The split exists because a database transaction and a Kubernetes create cannot commit together. The
controller therefore orders the two authorities so every recoverable partial state is harmless: a
crash may leave an exact suspended Job to adopt later, but never an executing Job whose UID was not
accepted by OpenCrane.

```
 OpenCrane workflow task .... loads one authorised attempt
              │
              ▼
 ┌───────────────────────────────────┐
 │ runtime/controller  ◄── HERE       │  exact create or exact adoption
 └──────────────┬────────────────────┘
                ▼
 runtime namespace policy already present
                │
                ▼
 suspended Job → server stores Job UID
                                  │ workflow release lease
                                  ▼
                         conditional unsuspend → first Pod UID
```

**In this flow:** [runtime Job builder](../k8s-launcher/README.md) ·
[OpenCrane server](../../../../../apps/opencrane/README.md) ·
[agent-controller app](../../../../../apps/agent-controller/README.md)

Invariant: deployment owns one fail-closed policy and one least-privilege RoleBinding per configured
runtime namespace, while this controller creates only deterministic Jobs. An existing Job is adopted only when its complete owned
contract matches. Release converts the durable assignment's absolute expiry into a conservative
whole-second deadline, then tests Job UID, resource version, `suspend=true`, and the profile deadline
before lowering that deadline and unsuspending in one patch. The bound reserves both the database
release-lease horizon and a complete Kubernetes patch timeout. A crash after release is recoverable:
the exact unsuspended Job is adopted only when its Kubernetes start time plus deadline proves it
ends by the durable expiry; zero Pods means retry while multiple or foreign Pods fail closed.

## Public surface

- `__ValidateAgentControllerRuntimeProfiles` — validates deployment-supplied profiles through the
  canonical Job builder before the controller registers its workflow handler.
- `__CreateKubernetesAgentControllerStore` — exposes exact Job adoption, create-only model-key
  Secret creation, expiry-bounded fenced Job release, and selector-bounded first-Pod listing.

Internally, profile validation, Kubernetes Job adoption, conditional release planning, and Pod proof
each have one module owner. The package barrel exposes the Kubernetes store and profile-map type.

## Boundary

The package does not read Postgres directly, create ServiceAccounts, Pods, volumes or Deployments,
read/update/delete Secrets, watch Kubernetes, replace an object, mutate a Pod, or issue runtime
commands. Its only Secret power is creating the immutable, Job-owned model-key Secret (an
AlreadyExists response is an idempotent success, never re-read); it can lower
`spec.activeDeadlineSeconds` and patch `spec.suspend` from true to false together only after all
identity tests pass. The minted key is transient — written straight into the Secret, never persisted
or logged — and the LiteLLM master key stays in the control plane. OpenCrane remains business
authority; Kubernetes remains an execution projection.

## Dependency direction

Tagged `scope:agent-runtime-controller` and `layer:infra`; it may depend only on the runtime Job
builder and shared contracts/observability. It never imports an app, OpenCrane-server infrastructure,
or Prisma.

## Runtime & config

The app supplies an immutable profile map. Every profile supplies one unique runtime namespace,
which must be valid and different from its server namespace; a mismatched workflow record is refused
before Kubernetes I/O.
The Kubernetes adapter relies on a Role in the runtime namespace granting `get/create/patch` for
Jobs, `list` for Pods, and `create` (only) for Secrets. It has no Kubernetes Networking client. It lists Pods with both the Job-controller UID
and deterministic attempt label; it has no Pod `get`, mutation, delete, or watch privilege. Every
release reconciliation opens one parent trace around its claim, Kubernetes changes, Pod discovery,
registration and outcome log; the opaque bootstrap reference is never a trace attribute. Every
Kubernetes create, read, patch, and list has its own hard deadline. The patch timeout is subtracted
from remaining assignment authority before release, so delayed transport cannot extend execution.
Shutdown aborts an in-flight
request through the Kubernetes client itself, while a later retry receives a new deadline.

## See also

- Parent group: [runtime](../README.md)
- Manifest builder: [k8s-launcher](../k8s-launcher/README.md)
- Process owner: [agent-controller](../../../../../apps/agent-controller/README.md)
