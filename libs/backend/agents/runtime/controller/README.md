# @opencrane/backend/agents/runtime/controller — attempt workload reconciliation

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › controller

## What it owns

This package is the narrow reconciliation step between OpenCrane's durable run authority and
Kubernetes execution state. It first claims an authorised attempt, resolves its named runtime
profile, verifies that profile's dedicated runtime namespace, and creates the still-suspended Job
there. It then creates the
attempt's immutable, Job-owned LiteLLM key Secret from the transient virtual key delivered on the
claim response — before the Job can be released — so the released Pod is admitted and the Secret is
garbage-collected with the Job. A second durable reconciliation releases only the exact assigned Job
and registers its unique first Pod.

The split exists because a database transaction and a Kubernetes create cannot commit together. The
controller therefore orders the two authorities so every recoverable partial state is harmless: a
crash may leave an exact suspended Job to adopt later, but never an executing Job whose UID was not
accepted by OpenCrane.

```
 OpenCrane run outbox ........ claims one authorised attempt
              │
              ▼
 ┌───────────────────────────────────┐
 │ runtime/controller  ◄── HERE       │  exact create or exact adoption
 └──────────────┬────────────────────┘
                ▼
 runtime namespace policy already present
                │
                ▼
 suspended Job → OpenCrane stores Job UID
                                  │ durable release claim
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

- `__RunAgentController` — polls until process shutdown and retries failed claims without repairing
  or replacing workload projections.
- `__ValidateAgentControllerRuntimeProfiles` — validates deployment-supplied profiles through the
  canonical Job builder before polling starts.
- `__CreateHttpAgentControllerAuthority` — claims and commits over the projected-token-authenticated
  internal OpenCrane API.
- `__CreateKubernetesAgentControllerStore` — exposes exact Job adoption, create-only model-key
  Secret creation, expiry-bounded fenced Job release, and selector-bounded first-Pod listing.
- `__CreateLocalProcessAgentControllerStore` — development-only workload host that keeps the same
  assignment and release authority while projecting each attempt into the existing Python runtime
  process instead of a Kubernetes Job.
- `__CreateLocalAgentRuntimeTokenReviewer` — development-only HMAC reviewer that authenticates the
  spawned process UID before returning the fixed runtime namespace and ServiceAccount identity.
The same controller performs the bounded retention pass for successfully delivered runtime-outbox
records. It runs once at startup, then at its configured interval. A failed pass is recorded and
retried at the next interval; it can never prevent workload reconciliation or keep the controller
alive after shutdown.

Internally, the polling loop, runtime-profile policy, model-key projection, assignment reconcile,
release reconcile, bounded HTTP decoding, Kubernetes Job adoption, conditional release planning,
Pod proof, and transport calls each have one module owner. The package barrel exposes composition
capabilities and the profile-map type. The one-attempt
assignment and release steps remain package-private test seams. Zod validation of controller wire
models is owned beside those models in `@opencrane/contracts`; this package does not redeclare their
accepted fields.

## Boundary

The production Kubernetes adapter does not read Postgres directly, create ServiceAccounts, Pods, volumes or Deployments,
read/update/delete Secrets, watch Kubernetes, replace an object, mutate a Pod, or issue runtime
commands. Its only Secret power is creating the immutable, Job-owned model-key Secret (an
AlreadyExists response is an idempotent success, never re-read); it can lower
`spec.activeDeadlineSeconds` and patch `spec.suspend` from true to false together only after all
identity tests pass. The minted key is transient — written straight into the Secret, never persisted
or logged — and the LiteLLM master key stays in the control plane. OpenCrane remains business
authority; Kubernetes is the production execution projection, while the development adapter projects
the same authority into local processes.

## Dependency direction

Tagged `scope:agent-runtime-controller` and `layer:infra`; it may depend on the runtime Job builder,
shared contracts/observability, and the pure local-development strategy vocabulary used by its local
process adapter. It never imports an app, OpenCrane-server infrastructure, or Prisma.

## Runtime & config

The app supplies a bounded poll interval and an immutable profile map. Every profile supplies one
unique runtime namespace, which must be valid and different from its server namespace; a claim in a
different namespace is refused before Kubernetes I/O. The HTTP
adapter rereads its projected token for every request so kubelet rotation needs no process restart.
The Kubernetes adapter relies on a Role in the runtime namespace granting `get/create/patch` for
Jobs, `list` for Pods, and `create` (only) for Secrets. It has no Kubernetes Networking client. It lists Pods with both the Job-controller UID
and deterministic attempt label; it has no Pod `get`, mutation, delete, or watch privilege. Every
release reconciliation opens one parent trace around its claim, Kubernetes changes, Pod discovery,
registration and outcome log; the opaque bootstrap reference is never a trace attribute. Every
Kubernetes create, read, patch, and list has its own hard deadline. The patch timeout is subtracted
from remaining assignment authority before release, so delayed transport cannot extend execution.
Shutdown aborts an in-flight
request through the Kubernetes client itself, while a later retry receives a new deadline.

The local process adapter is composed only by `apps/agent-controller/src/development/index.ts`. It
writes the signed runtime token and bootstrap reference to a private per-attempt directory as `0600`
files. Alternatives A and B also receive an attempt-scoped LiteLLM-key file; Alternative C receives
no model endpoint or key file. The child receives an allowlisted environment containing those paths,
never inherited provider credentials. Alternatives A and B use the unchanged LiteLLM model loop;
Alternative C injects a deterministic neutral-event source after the same bootstrap and command
admission flow. The development server verifies each runtime bearer against the session launch secret
with a timing-safe HMAC comparison before recovering its Pod UID. This disposable host is not imported
by the production controller entrypoint.

## See also

- Parent group: [runtime](../README.md)
- Manifest builder: [k8s-launcher](../k8s-launcher/README.md)
- Process owner: [agent-controller](../../../../../apps/agent-controller/README.md)
