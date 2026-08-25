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

Starting a new runtime Kubernetes Job for every agent run is safe, but it takes time to schedule a
Pod and start its container. A **warm runtime pool** keeps a small number of already-started,
generic runtime Pods ready in each silo. A silo is one customer's isolated OpenCrane environment.

A warm Pod cannot be trusted merely because it is already running. Before it runs an agent's work,
OpenCrane must bind it to one admitted run attempt, select its fixed network profile, and prove that
it is ready to receive work. A Pod that has been used must never become generic again: it may have
held attempt-specific input or memory, even after the attempt ends.

The agent controller is the sole Kubernetes mutator for runtime Pods. PostgreSQL remains the source
of truth for runs and assignments. Absurd supplies the durable workflow: a **workflow** is a saved
series of steps that can continue after the server restarts. It must not make Kubernetes or network
policy decisions by itself; the existing controller and product authorities retain those roles.

The current fresh-Job runtime receives an attempt-specific bootstrap reference and LiteLLM virtual
key through files mounted in its Pod before it starts. Kubernetes cannot add those files to a Pod
that is already running. The warm path therefore needs a separate, explicit binding exchange; it
cannot pretend that the current fresh-Job bootstrap works unchanged.

## Decision

OpenCrane uses a claim-based warm runtime pool with this fixed lifecycle:

```text
generic warm Pod (fixed low-privilege identity, no attempt data)
        |
        | 1. reserve one Pod for one admitted run attempt
        v
OpenCrane records the exact Pod + assignment in the database
        |
        | 2. select the assignment's fixed Cilium network profile
        v
bind the Pod with a one-use assignment exchange, then probe it
        |
        | 3. only a healthy Pod is handed to the runtime protocol
        v
claimed runtime Pod (one attempt only)
        |
        | 4. run ends, is cancelled, or becomes idle
        v
controller deletes the exact used Pod; Kubernetes replaces it from the pool Deployment
```

- The warm pool is a new `WarmRuntime` workload class. It uses the existing Kubernetes
  `deployment` workload kind for the generic pool, one `warm-runtime` ServiceAccount, one
  `opencrane-warm-runtime` projected-token audience, the dedicated runtime namespace, and the
  fixed profile vocabulary owned by the agent-controller chart. The runtime-assignment contract
  records both the pool Deployment UID and the claimed Pod UID. It rejects the existing `job`
  class and the warm class as different kinds of assignment.
- Helm owns one fixed-replica pool Deployment for each configured warm profile. The Kubernetes
  Deployment controller, not Absurd or the agent controller, creates replacement Pods whenever a
  Pod is deleted. A recurring workflow only detects a stale generic Pod and records a server-owned
  deletion command; it never creates or scales a Kubernetes resource.
- A generic warm Pod has no run input, user credential, tool credential, database access, or general
  network egress. It has one fixed ServiceAccount with a separately named warm-runtime audience
  token. That token permits only readiness and the one-use binding exchange for the Pod's own UID;
  it cannot open an attempt stream or call the model proxy.
- A claim binds one exact Pod UID to one already-admitted `(silo, run, attempt, assignment)` before
  any network label changes. The durable assignment is the source of truth; Kubernetes labels are a
  projection of it, not a permission system.
- The Pod starts the binding exchange itself at a dedicated internal endpoint. It sends its Pod UID,
  fixed projected token, and newly generated public proof key. The server finds the one-use warm
  claim from those trusted values, rather than receiving an assignment reference from the
  controller or storing one in the Pod. It accepts the request only when the values match the
  recorded claim and selected profile. The server then binds the proof key and permits that exact
  Pod to open the attempt command stream. The attempt-scoped LiteLLM virtual key arrives only in
  the authenticated `start_attempt` command and remains in process memory; a claimed Pod never
  mounts a user, tool, provider, or database credential.
- The binding operation is one database transaction with a conditional first-write rule. It accepts
  the first proof-key thumbprint for the current warm claim, accepts a retry carrying that same
  thumbprint, and rejects a different thumbprint, expired claim, or already-used claim. The binding
  record commits before the server permits an attempt stream, so two simultaneous requests cannot
  bind one Pod to different proof keys.
- The server-owned workflow checkpoints after reservation, assignment, network activation, and
  readiness. The agent controller polls its authenticated desired-state command, performs only the
  exact Kubernetes call, and reports the observed Pod UID, resource version, and probe result. If
  the server or workflow worker restarts, it reads the saved result of each completed step and
  continues from the next one. If a later step fails, OpenCrane removes the assignment and sends
  the controller a deletion command. It never returns a used Pod to the pool.
- Cilium labels select a small fixed vocabulary of runtime network profiles. They never contain a
  run ID, person, team, or permission. The OpenCrane authorization decision and the authenticated
  assignment remain required for every runtime command.
- The controller changes only the dedicated warm-profile label. It first reads the exact Pod and
  then sends a JSON Patch that requires its UID and current resource version to match, and replaces
  the label only with the profile recorded in the durable assignment. A Kubernetes admission policy
  permits the controller identity to make only that label transition on Pods carrying the warm-pool
  owner label; it rejects every other Pod change and every label outside the fixed vocabulary.
  The server issues the controller's desired-state command and conditionally records its result;
  the workflow does not gain Kubernetes mutation rights or add a second Kubernetes mutator.
- The receiver validates the warm token with Kubernetes TokenReview and uses the reviewed
  ServiceAccount, namespace, and bound Pod UID, not the UID submitted in the request, to find the
  reservation. Before it allows `start_attempt`, the controller submits readiness evidence for that
  same Pod UID, resource version, and profile after a probe proves that the selected Cilium policy
  has taken effect. A successful label patch by itself is never readiness evidence.
- A recurring idle-timeout workflow finds generic Pods that are older than their allowed lifetime
  and records an exact deletion command. The controller reads the named Pod, checks its UID,
  Deployment owner UID, warm-pool owner label, and expected generic or claimed profile, then uses
  a delete precondition for that UID. The Kubernetes admission policy permits this controller
  identity to delete only Pods with that pool owner label. The Deployment controller replaces the
  Pod. A used Pod cannot restart in place or return to the generic pool.
- The current fresh-Job path remains the baseline until the live latency gate proves that an Absurd
  worker can pick up a claim quickly enough and the full aggregate cutover has passed review. It
  remains the only writer for every attempt during that period.
- The warm claim workflow is spawned through `workflows/contract` in the same database transaction
  that records the new warm assignment, using one stable `(silo, run, attempt)` key. It does not
  write, read, or acknowledge the current `RunAttemptRequested`, workload-release, or cleanup
  outbox events. The fresh-Job path remains the only writer until the complete runtime-assignment
  aggregate replacement below is ready and the live latency gate has passed.

## Alternatives considered

- **Reuse a Pod after a run** — rejected. A cleanup error could leak run input or credentials into a
  later attempt. Terminating it makes the boundary clear and testable.
- **Let the runtime Pod claim itself** — rejected. That would give an untrusted workload the power
  to choose its own assignment or network profile.
- **Put user or team permission labels on Pods** — rejected. Cilium labels control reachability;
  they are not dynamic business authorisation.
- **Use only a Kubernetes controller loop** — rejected for the claim sequence. A restart between
  the database and Kubernetes operations needs durable saved steps and compensation. The existing
  controller still owns the Kubernetes calls.
- **Use an endless workflow sleep for pool maintenance** — rejected. Its saved history grows for as
  long as the service runs. The scheduler's short follow-up tasks keep each history bounded.

## Consequences

- The warm-pool implementation needs a new product-owned reservation and binding record,
  `WarmRuntime` identity contract, warm-runtime token audience, one-use binding endpoint, and
  server-owned desired-state commands that the controller polls for pool reconciliation, profile
  activation, readiness checks, and exact Pod deletion.
  It replaces the current fresh-Job runtime-assignment aggregate in one complete cutover: admission,
  assignment, bootstrap, stream admission, cancellation, and cleanup move together. There is no
  period where the old outbox writer and a warm-pool writer can claim one attempt. The record must
  be migrated through an additive release path; it must not alter an already-applied database
  migration.
- The agent-controller chart will need narrow Pod `get`, label-patch, and delete permissions; a
  Kubernetes admission policy; a Cilium policy layer; and an explicit warm-pool profile. Tests must
  prove the generic and claimed network paths are different and must reject a wrong UID, stale
  resource version, Deployment owner, profile, or binding reference.
- Qualification must measure the full hand-off: a warm claim under one second and a pool miss under
  five seconds. Those are live deployment checks and are intentionally deferred from this build
  slice.
- The current runtime Job lifecycle remains authoritative until the whole runtime-assignment
  aggregate is moved. There is no mixed path where an old writer and a warm-pool writer both claim
  the same attempt.
