# ADR 0014 — Claimed warm runtime pool

- **Status:** Accepted
- **Date:** 2026-08-25
- **Task:** [#592](https://github.com/elewa-git/opencrane/issues/592) ·
  [#695](https://github.com/elewa-git/opencrane/issues/695)
- **Supersedes:** the Job-only runtime-controller clause in
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md)
- **Related:** [ADR 0003](0003-cilium-spiffe-identity-substrate.md) ·
  [ADR 0008](0008-target-agent-contracts-and-workload-identity.md) ·
  [ADR 0010](0010-language-neutral-agent-runtime.md) ·
  [ADR 0013](0013-workflow-control-plane.md)

## Context

Starting a new Kubernetes Job for every AgentRun attempt isolates attempts, but Pod scheduling and
container startup add latency before any model work can begin. A warm runtime pool can remove that
startup delay by keeping a small number of generic agent-runtime Pods ready in each customer silo.

A pre-started Pod is not yet authorised to execute an attempt. OpenCrane must reserve it for one
admitted attempt, project the fixed network profile selected by that admission, prove the exact Pod
is ready through the selected path, and bind fresh proof evidence before releasing any execution
material. PostgreSQL remains authoritative for the reservation and attempt. Kubernetes objects and
labels are projections of that decision.

The Pod must also be disposable. It may have held attempt input, continuation state, or a scoped
model key in memory, so returning it to the generic pool would make cleanup correctness part of the
security boundary.

## Decision

OpenCrane uses fixed personal and managed warm pools. Each pool is a Helm-owned Deployment whose
generic Pods have a fixed low-privilege identity, no attempt data, and no product database,
provider, or tool credentials. They have one narrow Kubernetes-issued identity token for OpenCrane
TokenReview, but no Kubernetes API permission or general Kubernetes authority.

One AgentRun attempt follows this lifecycle:

```text
generic warm Pod
      │ reserve exact Deployment UID + Pod UID in PostgreSQL
      ▼
database-owned one-attempt reservation
      │ conditionally change only the fixed network-profile label
      ▼
claimed Pod
      │ prove exact Pod UID, resource version, profile and readiness
      ▼
one-use proof binding → scoped model key in process memory
      │ outbound authenticated command stream
      ▼
one AgentRun attempt
      │ completion, cancellation, failure or replacement
      ▼
UID-fenced Pod deletion → Deployment creates a fresh generic spare
```

- The AgentRun workflow reserves one generic candidate before any profile change. The reservation
  records the exact pool Deployment UID, Pod name, Pod UID, resource version, run, attempt, binding
  generation, and fixed personal or managed workload profile.
- The agent controller remains the sole Kubernetes mutator. It may list the configured pool, replace
  only the generic profile label with that pool's fixed claimed profile, probe the claimed Pod, and
  delete the saved Pod UID. It cannot select a user, run, revision, grant, budget, ServiceAccount,
  image, namespace, or arbitrary network policy.
- Profile activation uses a conditional JSON Patch that tests the Pod UID, resource version, and
  current generic profile. Kubernetes admission permits only the configured generic-to-claimed
  label transition on a Helm-owned warm Pod. A successful patch is not sufficient evidence: the
  controller must then receive the expected Pod-local readiness response through the claimed
  network path and record its observed profile and resource version.
- The runtime starts with only its rotating projected Kubernetes token and a newly generated public
  proof key. After activation, it calls the private binding endpoint without supplying a run or
  assignment coordinate. TokenReview supplies the trusted ServiceAccount, namespace, and bound Pod
  UID; the server finds the one ready reservation, commits the first proof-key thumbprint, and
  returns the attempt-scoped model key only in the response. A retry with the same thumbprint is
  idempotent; a different, expired, missing, or already-used binding fails closed.
- The runtime keeps the model key only in process memory and then opens the authenticated outbound
  command stream. It submits bounded events and action candidates; the OpenCrane server retains
  authority for input, approvals, tools, ordered events, cancellation, and terminal state.
- The durable workflow checkpoints reservation, activation, readiness, and exact deletion. It can
  resume those steps after a server or controller restart. A missing or terminal claimed Pod may be
  replaced through a new binding generation, but a used Pod is never made generic again.
- Cleanup first saves one-way deletion intent, verifies the exact Pod and Deployment owner chain,
  deletes with a Pod-UID precondition, and waits until that UID is absent. The Kubernetes Deployment
  controller, not OpenCrane, restores the pool replica.
- The timing contract requires the full admitted-to-ready warm claim to complete in under one
  second and a pool miss to produce a ready replacement in under five seconds. Source tests enforce
  the event-time contract; each target cluster must still qualify the complete hand-off.

## Alternatives considered

- **Create one Job per attempt** — rejected as the standard AgentRun path because scheduling and
  startup latency defeat the warm hand-off target. Isolated skill, artifact, and OCI MCP executor
  classes may still use their own governed Jobs.
- **Reuse a Pod after an attempt** — rejected because a cleanup defect could expose attempt input,
  continuation state, or credentials to the next assignment.
- **Let a runtime Pod choose or claim an assignment** — rejected because an untrusted workload must
  not choose its run or network authority. The Pod proves only the identity Kubernetes bound to it;
  the database reservation selects the attempt.
- **Put user, team, or permission labels on Pods** — rejected because network labels select a small
  reachability profile. They do not represent changing business authorisation.
- **Use only a Kubernetes controller loop** — rejected because reservation, recovery, cancellation,
  and cleanup must survive a process crash at the same durable boundary as the admitted run.
- **Keep one workflow asleep forever to maintain a pool** — rejected because its saved history would
  grow for the lifetime of the deployment. Helm and the Kubernetes Deployment controller own pool
  size and replacement.

## Consequences

- The warm-pool boundary adds a Pod-local readiness surface and a private one-use binding exchange,
  but no public runtime Service or Ingress.
- The controller needs narrowly scoped Pod read, label-patch, and UID-delete permissions plus a
  fail-closed admission policy. Runtime Pods keep no Kubernetes RBAC or database access.
- Reservation and deletion records must retain exact Kubernetes identities so retries cannot adopt,
  mutate, or delete a replacement object that reused a name.
- Personal and managed pools share the lifecycle mechanism while preserving distinct admission
  authorities, namespaces, profiles, and workload identities.
- Standard AgentRun Pods are one-use. Pool capacity returns only when Kubernetes creates a fresh
  generic Pod.
