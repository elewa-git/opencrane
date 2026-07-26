# @opencrane/backend/agents/runtime/k8s-launcher — suspended runtime Jobs

> [backend](../../../README.md) › [agents](../../README.md) › [runtime](../README.md) › k8s-launcher

## What it owns

This infrastructure package translates one already-authorised agent run attempt into its exact
suspended Kubernetes Job. Namespace-wide network isolation is installed once by the deployment;
the builder does not create a new policy for every attempt.

```
 authorised run attempt + immutable runtime profile
                 │
                 ▼
 ┌─────────────────────────────────────┐
 │  runtime/k8s-launcher  ◄── HERE      │  pure manifest construction
 └──────────────────┬──────────────────┘
                    ▼
suspended Job in the dedicated runtime namespace
                    │  controller persists Job UID; durable release then unsuspends
                    ▼
 agent-runtime process
```

**In this flow:** [runtime authority](../main/README.md) ·
[agent-runtime process](../../../../../apps/agent-runtime/README.md)

Invariant: the returned Job is always suspended, has one completion and no retry, and cannot receive
provider credentials or durable storage. The runtime namespace must differ from the OpenCrane server
namespace. Invalid authority coordinates or an unpinned or externally routed profile fail before any
Kubernetes adapter can perform input/output (I/O). The default ServiceAccount token is disabled. Its short-lived runtime token is mounted read-only, while
the non-secret bootstrap reference is separately projected from an exact Pod annotation through the
downward API (Kubernetes' read-only view of its own Pod metadata). Terminal cleanup and Pod
termination grace are both zero, so the Job-owned Pod and its non-durable scratch are not retained
after the deadline.

## Public surface

- `__BuildSuspendedAgentRuntimeJob(assignment, profile)` — builds the suspended Job for one run
  attempt.
- `__AgentRuntimeAttemptResourceName(siloId, runId, attempt)` — derives the same deterministic Job
  name when a server-owned cleanup authority must locate a fenced attempt without receiving a profile.
- `__DeriveAgentRuntimeReleaseDeadlineSeconds(assignmentExpiresAt, now, profileMaximum)` — converts
  absolute assignment authority into a conservative positive Kubernetes deadline.
- `AgentRuntimeJobAssignment` — the durable run, attempt, revision, silo, namespace, and opaque
  bootstrap-reference coordinates.
- `AgentRuntimeJobProfile` — the bounded ServiceAccount, immutable image, internal server namespace,
  route, deadlines, resources, and scratch limits fixed by the controller profile.

## Boundary

The builder is pure. It does not call Kubernetes, read Prisma, own run state, provision
ServiceAccounts, grant role-based access control (RBAC), or decide whether an attempt may execute.
`apps/agent-controller` is the only process allowed to create or exact-adopt these Jobs, persist
the Job UID, and later release that exact Job. This package only makes the authority's opaque
bootstrap reference available as a `0440` file; the reference alone never authenticates a runtime.

## Dependency direction

Tagged `scope:agent-runtime-launcher` and `layer:infra`; it may depend only on its own scope and shared
contracts. It never imports an application entrypoint or an OpenCrane-server infrastructure package.

## Runtime & config

There are no environment variables or I/O. The caller supplies a digest-pinned image, a cross-namespace
runtime-stream URL, bounded zero-RBAC ServiceAccount, a 600–3600
second token lifetime, finite maximum deadline, immediate terminal cleanup, at most 1 GiB scratch,
and explicit CPU/memory resources. The
rendered Pod runs as UID/GID 65532 with `fsGroup: 65532`; projected token and bootstrap-reference
mode `0440` therefore remain readable without becoming world-readable. The bootstrap reference is
mounted at `/var/run/opencrane/bootstrap/reference`, never in environment variables or process arguments.

## See also

- Parent group: [runtime](../README.md)
- Runtime authority: [main](../main/README.md)
- Server transport: [agent-runtime-stream](../../../../server/_infra/agent-runtime-stream/README.md)
- Process owner: [agent-runtime](../../../../../apps/agent-runtime/README.md)
