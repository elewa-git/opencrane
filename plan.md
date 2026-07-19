# OpenCrane — Active Plan

> **Rebased 2026-07-18: direct personal-agent product refactor.** OpenCrane is still being built;
> there is no production estate to preserve or transition. Implementation detail lives in linked
> GitHub issues; this file is the sequencing index. Completed history lives in `plan-done.md` and
> the git history of this file.

## Decision record (2026-07-18)

The [personal-agent platform architecture](docs/design/personal-agent-platform-architecture.md) is
the target, refined by the
[OpenClaw loop investigation](docs/design/openclaw-agent-loop-replacement-plan.md):

1. **Product:** OpenCrane owns Thread, Message, Run, RunEvent, approvals, transcript, compaction,
   retries, budgets, identity, memory, artifacts, and tool policy. A conformance-selected
   **TypeScript** toolkit (`@openai/agents` primary spike, `ai`/`ToolLoopAgent` control) owns only
   the bounded model/tool loop. Python remains isolated in tool Jobs.
2. **Delivery:** refactor the repository directly to the target state. Delete OpenClaw and every
   obsolete schema, protocol, app, bridge, token path, database assumption, configuration switch,
   test, deployment unit, and document as its replacement becomes ready. Do not preserve, transform,
   or bridge existing OpenCrane state; build only the target product path. Historical transition
   proposals are rejected. The
   [direct-refactor plan](docs/design/personal-agent-platform-direct-refactor-plan.md) documents the
   target-state build.
3. **Sequencing:** Phase A deletion debt and Phase B monorepo normalization are complete. Build the
   target foundations and fresh provisioning next; then the runtime and AgentService planes; then
   product surfaces; finally qualify the complete product and verify zero legacy residue.
   Phase gates and their PRs land sequentially on the root workstream branch
   `own-personal-ai-agent-setup`; independent
   work lanes inside the active phase run in parallel where their dependency graph allows.
4. **Architecture:** Postgres is product authority; artifacts live behind `ArtifactStore` on PVC;
   authorization is per silo with proof-bound run/action capabilities; runtimes receive no
   Kubernetes mutation RBAC; Cilium/default-deny enforces workload isolation; Python Jobs are
   isolated; controller and channel-proxy trust boundaries are separate apps; legacy CRDs and
   OpenClaw authorities disappear.
5. **Sandbox jobs:** OpenSandbox is scheduled as the exact-pinned execution substrate for
   non-Obot sandbox Jobs, behind an OpenCrane-owned adapter. OpenCrane still owns authorization,
   identity, scheduling, canonical events, artifacts, and recovery; Obot still owns MCP credential
   custody. Each attempt receives only an expiring, proof-bound subset of the spawning agent's
   effective rights for the approved action—never copied credentials or broader ambient authority.
   The upstream lifecycle API is internal-only and its Kubernetes rights are confined to the
   sandbox namespace and workload profile (see
   [ADR 0009](docs/adr/0009-opensandbox-sandbox-job-substrate.md)).
6. **Live runs and steering:** every visible callback is committed as an ordered `RunEvent` before
   cursor-based SSE delivery. Mid-run input is a canonical Message, absorbed once at the next
   model-decision boundary or durably deferred when the terminal transition wins; the UI observes
   the same result after reconnect or recovery.

Toolkit selection remains evidence-driven: the Phase E conformance run chooses one exact-pinned
driver (→ [#246](https://github.com/italanta/opencrane/issues/246)).

## Current state

The silo foundations (S1–S6) are merged: fleet/silo separation, Zitadel-backed membership,
organization OIDC, scope vocabularies, BYOK provider keys, same-origin ingress, and Cognee-backed
organization memory. These are reusable only where they match the adopted target contracts.
OpenClaw-coupled behavior and retired domain contracts are deletion candidates, not compatibility
requirements.

## Program — personal-agent platform

The executable phase detail is in the
[direct target-state refactor plan](docs/design/personal-agent-platform-direct-refactor-plan.md).
Issues are cut when a phase opens. Each phase ends with architecture, reaper, validation, and
independent-review gates before its PR is merged.

### Phase A — deletion debt — ✅ COMPLETE (see `plan-done.md`)

The `oc` CLI and other confirmed deletion debt were removed. Remaining legacy paths are deleted in
the phase that replaces their responsibility.

### Phase B — monorepo topology: apps are lightweight rollups — ✅ COMPLETE (see `plan-done.md`)

Every deployable or Job class must have one `apps/<name>` owner or a deployment-only
`apps/_infra/<name>` owner; reusable behaviour belongs in functional `libs/*` packages with
enforced dependency direction.

### Phase C — target contracts and app ownership — ✅ COMPLETE (see `plan-done.md`)

Canonical agent, transcript, authorization, membership, persona, artifact, storage, update, and
workload-identity contracts now define the Phase D implementation boundary. The binding decision is
[ADR 0008](docs/adr/0008-target-agent-contracts-and-workload-identity.md).

### Repository cohesion — ✅ COMPLETE (see `plan-done.md`)

Deployment-only app owners now live under `apps/_infra`, OpenCrane's installation chart is
`apps/_infra/deploy-k8s`, reusable server domains are grouped under `libs/backend/server`, and
process-supporting server internals are isolated under `libs/server/_infra`. This is a direct
path and ownership refactor; it adds no compatibility aliases and changes no runtime behaviour.

### Phase D — foundations, identity, and fresh provisioning

Build the target Postgres models for AgentService/Revision/Run, Thread/Message/RunEvent, Approval,
Persona, Artifact, SkillRevision, audit, and membership projection. Build the authorization facade,
proof-bound capabilities, the workload-authenticated fenced run-ingest API and post-commit SSE
projection, the durable steering inbox, model-decision boundary claim, and input-generation terminal
guard for model-derived outcomes plus generation-independent authoritative stops, channel proxy,
agent controller, ArtifactStore CAS, outbox, app-owned
Cognee/Obot adapters, the OpenSandbox adapter and confined deployment boundary, default-deny Cilium
profiles, workload identities, and deterministic creation of fresh application stores and
credentials. Every durable store uses an expandable mounted volume; agent-runtime and sandbox-job
storage is mounted scratch and never the long-term home for user data.

Delete replaced legacy schemas, Tenant/AccessPolicy authority, OpenClaw imports, static agent-token
paths, broad secret broadcasts, obsolete topology switches, and unowned deployables in the same
slices. CI rejects reintroduction. [#117](https://github.com/italanta/opencrane/issues/117) supplies
the enforcing-CNI work; [#221](https://github.com/italanta/opencrane/issues/221) generalizes the
identity matrix; [#128](https://github.com/italanta/opencrane/issues/128) becomes the target Obot
adapter and fresh user-authorized integration flow — seeded by porting PR #241's reviewed Obot
custody/credential/discovery slices from `main` per
[#255](https://github.com/italanta/opencrane/issues/255).

Exit: a fresh environment is created from reviewed target artifacts alone; IAM and network negative
tests fail closed; backup/restore reconstructs target-owned stores; no legacy contract is reachable.

### Phase E — personal runtime and AgentService plane (parallel work lanes)

**Runtime lane** (→ [#246](https://github.com/italanta/opencrane/issues/246)): implement
`RunInputSnapshot`, the prompt compiler, independently authored target fixtures, toolkit conformance
against the target LiteLLM matrix, one exact-pinned driver, the reliability envelope,
interview-generated PersonaRevision and PreferenceFact learning, multimodal and document authoring,
and governed Python skill Jobs on an exact-pinned OpenSandbox runtime. The driver must emit live
model, tool, approval, progress, usage, and terminal callbacks; OpenCrane persists each normalized
`RunEvent` before streaming it to the UI by cursor so long tasks remain visibly active and reconnect
without gaps. Mid-run user input remains a canonical Message: a fenced, idempotent boundary claim
absorbs it once before the next model request, or the terminal transition durably defers it to the
next run. A sandbox attempt receives only an expiring, proof-bound subset of the spawning agent's
effective rights for the exact approved action; no agent credential or ambient authority is copied
([#222](https://github.com/italanta/opencrane/issues/222),
[#243](https://github.com/italanta/opencrane/issues/243)).

**AgentService lane:** implement AgentService/Revision/Run, organization/department/team/project/
personal/user sharing, schedules, one-attempt Jobs, approvals, effective access, audit, cost, and the
one-way personal→managed boundary ([#129](https://github.com/italanta/opencrane/issues/129)). Port
useful Slack behavior only as schedule + MCP + skill + checkpoint; delete the interval worker and
direct Cognee writes.

Exit: the canonical runtime and managed-agent lifecycle pass failure, replay, authorization,
isolation, cancellation, provider, and artifact tests with no OpenClaw compatibility surface. Every
user-visible event is committed before delivery, cursor replay is gapless after disconnect or
process death, slow clients cannot block execution, and sandbox attempts pass idempotency, egress,
cancellation, ArtifactStore publication, expiry, deletion, inherited-rights, and privilege-expansion
negative tests. Old-attempt, cross-silo, wrong-workload, expired, cancelled, and revoked proofs fail;
steering cannot mutate an in-flight assignment. Steering survives retries, terminal races, and Pod
replacement with one visible `steering.absorbed` or `steering.deferred` outcome.

### Phase F — product and operator surfaces

Deliver one OpenCrane API/UI for conversation, persona, memory, agent catalog and revisions,
schedules and runs, approvals, assets, skills, membership, effective-access explanation, audit,
health, model/cost/budget, and runtime versions
([#224](https://github.com/italanta/opencrane/issues/224),
[#226](https://github.com/italanta/opencrane/issues/226)). Upstream consoles remain diagnostic.

Exit: named end-to-end user and operator journeys work only through the target APIs and UI;
parallel legacy product surfaces are deleted.

### Phase G — product qualification and zero-residue verification

Provision a clean environment and run the complete acceptance matrix: personal memory and persona,
transcript recovery, tools and approvals, grants and membership staleness, artifacts, multimodal and
document workflows, skill isolation, schedules, provider failover, load/cost, security, backup/
restore, observability, and on-call runbooks. Zero Critical/High findings and all named critical
journeys passing are release gates. Future application rollout tests must reach ready target Pods in
under five minutes per silo while remounting existing durable storage.

Verify that the owning replacement slices already deleted OpenClaw runtime/config/protocol/plugin/
workspace surfaces, legacy CRDs and schemas, projections, `feat-skill-registry`,
`feat-central-agents`, Zot-only paths, Linkerd, obsolete topology values, old images/secrets/docs/
tests, and temporary feature-prefixed naming. Any remaining item blocks qualification and is removed
in its owning replacement phase, not deferred here
([#227](https://github.com/italanta/opencrane/issues/227),
[#231](https://github.com/italanta/opencrane/issues/231)). Update README, CHANGELOG, website,
runbooks, generated clients, and CI forbidden-reference checks.

Exit: a fresh checkout builds and deploys only the target product. Operators have one supported path
to create, share, schedule, observe, revoke, and delete agents and assets.

## Issue disposition

| Issue | Target-state action |
|---|---|
| [#127](https://github.com/italanta/opencrane/issues/127) | Keep enforcing CNI, per-silo routing, encrypted-storage preflights, and live probes |
| [#128](https://github.com/italanta/opencrane/issues/128) | Build app-owned Obot custody, grants, and runtime-neutral MCP invocation; delete fake-success paths |
| [#129](https://github.com/italanta/opencrane/issues/129) | AgentService/Revision/Run/schedule epic with strict personal→managed boundary |
| [#133](https://github.com/italanta/opencrane/issues/133) | Supersede Zot-only skills with ArtifactStore-backed SkillRevision |
| [#135](https://github.com/italanta/opencrane/issues/135) | Remove broad provider-secret broadcast with the owning legacy path |
| [#136](https://github.com/italanta/opencrane/issues/136) | Defer compute tiers and pooling until measured target workload evidence exists |
| [#150](https://github.com/italanta/opencrane/issues/150) | Retain only target fleet/silo lifecycle and OIDC contract work |
| [#154](https://github.com/italanta/opencrane/issues/154) | Replace generic plugin-kernel work with concrete app/module contracts |
| [#162](https://github.com/italanta/opencrane/issues/162) | Retain target chart-native UI deployment work |
| [#174](https://github.com/italanta/opencrane/issues/174) | Fix bounded LiteLLM provisioning/reconcile behavior if it remains in the target adapter |
| [#220](https://github.com/italanta/opencrane/issues/220) | Delete OpenClaw-specific scope; carry least privilege into target workload profiles |
| [#221](https://github.com/italanta/opencrane/issues/221) | Generalize canonical KSA identity and repair into the target identity matrix |
| [#222](https://github.com/italanta/opencrane/issues/222) | Build artifact-backed, scanned, signed, revocable skills and isolated Python execution |
| [#224](https://github.com/italanta/opencrane/issues/224) | Build the target model/cost/provider/budget console |
| [#225](https://github.com/italanta/opencrane/issues/225) | Retain runtime-neutral stream/render/artifact/security work; delete OpenClaw gateway scope |
| [#226](https://github.com/italanta/opencrane/issues/226) | Build membership management over authoritative target APIs |
| [#227](https://github.com/italanta/opencrane/issues/227) | Delete packages and images when their replacement slice lands |
| [#231](https://github.com/italanta/opencrane/issues/231) | Introduce final target names directly; do not preserve legacy DNS or aliases |
| [#255](https://github.com/italanta/opencrane/issues/255) | Close pre-pivot PRs #247 (superseded by ADR 0007 and this plan) and #241; port #241's Obot custody/credential/discovery slices at Phase D |

## Deferred research

- Dedicated compute, pooling, scale-to-zero optimization, and additional guardrail services wait for
  measured target workload, security, and cost evidence.
- A generic plugin framework remains deferred until at least two concrete target modules require the
  same extension seam.
