# OpenCrane — Active Plan

> **Rebased 2026-07-18: direct personal-agent product refactor.** OpenCrane is still being built;
> there is no production estate to preserve or transition. Implementation detail lives in linked
> GitHub issues; this file is the sequencing index. Completed history lives in `plan-done.md` and
> the git history of this file.

## Decision record (2026-07-18)

The [personal-agent platform architecture](docs/design/personal-agent-platform-architecture.md) is
the target:

1. **Product:** OpenCrane owns mode-bound Conversation, Message, canonical timeline, Run, RunEvent,
   approvals, transcript, compaction, retries, budgets, identity, memory, artifacts, and tool policy.
   AgentRun is a conditional child of `agent_session`, never the backing record for direct or ordinary
   group messages ([ADR 0012](docs/adr/0012-conversation-modes-and-agent-thread-authority.md)). The runtime is a replaceable
workload behind a **language-neutral** `AgentRuntimeProtocol v2` ([ADR 0010](docs/adr/0010-language-neutral-agent-runtime.md));
   `pydantic-ai-slim` (Python) is the first qualification candidate for the bounded model/tool loop,
   adopted only after it passes the live-LiteLLM conformance gate. Language is not a product contract.
2. **Delivery:** refactor the repository directly to the target state. Delete OpenClaw and every
   obsolete schema, protocol, app, bridge, token path, database assumption, configuration switch,
   test, deployment unit, and document as its replacement becomes ready. Do not preserve, transform,
   or bridge existing OpenCrane state; build only the target product path. Historical transition
   proposals are rejected.
3. **Sequencing:** Phase A deletion debt and Phase B monorepo normalization are complete. Build the
   target foundations and fresh provisioning next; then the runtime and AgentService planes; then
   product surfaces; finally qualify the complete product and verify zero legacy residue.
   Phase gates and their PRs land sequentially on the root workstream branch
   `own-personal-ai-agent-setup`; independent
   work lanes inside the active phase run in parallel where their dependency graph allows.
4. **Architecture:** Postgres is product authority; artifacts live behind `ArtifactStore` on PVC;
   authorization is per silo through the central durable authority and one-use ToolInvocation
   admissions; runtimes receive no
   Kubernetes mutation RBAC; Cilium/default-deny enforces workload isolation; Python Jobs are
   isolated; controller and channel-proxy trust boundaries are separate apps; legacy CRDs and
   OpenClaw authorities disappear.

Toolkit selection remains evidence-driven: the offline Phase E conformance harness, immutable
managed run admission and tagged personal/managed input contract, fault-injection matrix,
controller, and runtime boundaries are built and CI-runnable. Live PostgreSQL, OCI MCP execution,
Cognee, and LiteLLM qualification remains gated on
[#337](https://github.com/elewa-git/opencrane/issues/337)
(→ [#246](https://github.com/elewa-git/opencrane/issues/246)); only passing evidence adopts the
exact-pinned driver and permits deletion of the replaced live path.

## Current state

The silo foundations (S1–S6) are merged: fleet/silo separation, Zitadel-backed membership,
organization OIDC, scope vocabularies, BYOK provider keys, same-origin ingress, and Cognee-backed
organization memory. These are reusable only where they match the adopted target contracts.
OpenClaw-coupled behavior and retired domain contracts are deletion candidates, not compatibility
requirements.

## Program — personal-agent platform

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
process-supporting server internals are isolated under `libs/backend/server/infra`. This is a direct
path and ownership refactor; it adds no compatibility aliases and changes no runtime behaviour.

### Phase D — foundations, identity, and fresh provisioning

Build the target Postgres models for AgentService/Revision, Conversation/Message/canonical timeline,
conditional AgentRun/RunEvent, Approval, Persona, Artifact, SkillRevision, audit, and membership
projection. Build the authorization facade,
central product grants, channel proxy, agent controller, ArtifactStore CAS, outbox, app-owned
Cognee integration, OCI-backed MCP execution, default-deny Cilium profiles, workload identities, and deterministic creation
of fresh application stores and credentials. Every durable store uses an expandable mounted volume;
agent-runtime storage is mounted scratch and never the long-term home for user data.

Delete replaced legacy schemas, Tenant/AccessPolicy authority, OpenClaw imports, static agent-token
paths, broad secret broadcasts, obsolete topology switches, and unowned deployables in the same
slices. CI rejects reintroduction. [#117](https://github.com/elewa-git/opencrane/issues/117) supplies
the enforcing-CNI work; [#221](https://github.com/elewa-git/opencrane/issues/221) generalizes the
identity matrix. The 0.10 cutover removes Obot custody and transport; admitted MCP revisions now
execute from imported immutable OCI images under central authorization.

Exit: a fresh environment is created from reviewed target artifacts alone; IAM and network negative
tests fail closed; backup/restore reconstructs target-owned stores; no legacy contract is reachable.

### Phase E — personal runtime and AgentService plane (core runtime built; phase incomplete)

**Core runtime built and CI-qualified:** the dependent PR stack now defines immutable run input, the
fenced runtime protocol, the outbound-only runtime process, and fixed warm Pod pools. The saved
AgentRun workflow reserves one Pod, binds the exact database assignment, drives readiness and work,
and removes that same Pod during cancellation or terminal cleanup. A nonterminal `Cancelling` run
state fences the current assignment, proof key, and pending approvals before the workflow removes
physical work; only workflow completion moves the run to `Cancelled`. The runtime protocol and
channel-target admission fences close on `cancelling` the same way they close on a terminal state.
Bootstrap exchange and the full runtime command lifecycle now land: the dispatch authority mints
`start_attempt`, `resume_attempt`, and a positive `cancel_attempt` stop signal with exactly-once
terminal reporting under a race. The runtime surfaces model tool calls as external-action candidates
that the server validates against the immutable snapshot and admits into the durable ToolInvocation
lifecycle before any provider request.
A tool grant flagged `requiresApproval` enters `AwaitingApproval` and opens a pending
`ApprovalRequest`, so the pause is reachable end to end. The owner-bound approval-DECISION and
steering-INGEST APIs are built:
an owner may decide only their own pending tool approval or queue bounded text only to their own live
run. The approval authority persists approved effective arguments or a terminal failure, and the
server-owned worker records one durable result delivery before a fenced resume command can carry it
back to the runtime. Later results and steering requests remain independently consumable, so
concurrent input cannot supersede an active executor loop. The runtime absorbs queued steering only
at safe pre-model boundaries. At a tool or participant wait, the runtime sends its bounded model
messages and pending result links to the server. The server encrypts that continuation and saves it
in the database. A replacement warm runtime receives the exact saved state through a fenced resume
command; a Pod lost during an active model call instead moves the run to `RecoveryRequired` because
replaying that call could duplicate cost or output. The MCP and sandbox execution ports remain fail-closed in
the production composition root. The authenticated memory transport IS composed: the server mounts
its audience-bound projected token and shares one gateway client between admission and dispatch.
Admission-time recall freezes gateway-selected fact references (id + content digest, never text)
into the personal `RunInputSnapshot`, and compile-time statement loading re-resolves and
digest-verifies every reference before inlining it — so redelivered `start_attempt` frames stay
byte-identical or fail closed. Mid-run recall now uses the same server-owned ToolInvocation worker and
durable, attempt-fenced result delivery as integration tools; persisted receipts must not duplicate
Cognee fact content. Record, correction, forgetting, and scoped injection remain fail-closed pending
a recoverable gateway write lifecycle.

**MEMORY TRANSPORT COMPOSED; ADMISSION+COMPILE RECALL LIVE; DURABLE MID-RUN RESULTS BUILT; WRITES STILL GATED**

The offline conformance harness and fault-injection matrix are built and CI-runnable (runtime protocol/reliability, attempt-scoped
credential rejection, observability evidence). The live-LiteLLM conformance leg and driver-adoption
evidence remain gated on [#337](https://github.com/elewa-git/opencrane/issues/337). The remaining
E1/E2 product capabilities below are also incomplete.

**Runtime lane** (→ [#246](https://github.com/elewa-git/opencrane/issues/246)): implement
`RunInputSnapshot`, the TypeScript-owned prompt compiler, the language-neutral `AgentRuntimeProtocol v1`
([ADR 0010](docs/adr/0010-language-neutral-agent-runtime.md)), independently authored target fixtures,
Pydantic-AI-first qualification against the target LiteLLM matrix, one exact-pinned driver, the reliability envelope,
interview-generated PersonaRevision and PreferenceFact learning, multimodal and document authoring,
and governed Python skill Jobs
([#222](https://github.com/elewa-git/opencrane/issues/222),
[#243](https://github.com/elewa-git/opencrane/issues/243)).

**AgentService lane:** implement AgentService/Revision/Run, organization/department/team/project/
personal/user sharing, schedules, one-attempt Jobs, approvals, effective access, audit, cost, and the
one-way personal→managed boundary ([#129](https://github.com/elewa-git/opencrane/issues/129)).
**Central agents** — org-, department-, team-, or otherwise shared managed AgentServices that run on a
schedule or a specific trigger to do one bounded task — run on the same runtime substrate as personal
agents but under a narrower, connector-scoped workload identity independent of any human user. They
reach external systems only through centrally authorised MCP revisions imported as immutable OCI
images. The
legacy ingestion interval worker and its direct Cognee writes are deleted.
Conversation-initiated config changes (always-granted `upgrade_session` tool,
logged persona refresh, apply-at-next-snapshot) → [#318](https://github.com/elewa-git/opencrane/issues/318).

**Central-agents sub-lane** (slice 6, [#332](https://github.com/elewa-git/opencrane/issues/332) — closes
[#129](https://github.com/elewa-git/opencrane/issues/129)): BUILT (offline) — the scheduler semantics
(`backend-server-agent-scheduling`, composed inside `apps/opencrane`: cron+timezone eval, missed-run
catch-up, overlap/backoff/suspension, idempotent run creation through the existing
`ManagedRunAdmissionPort` with `trigger: schedule`), the `AgentServiceSchedule` model + management
API, the connector-scoped managed identity (a managed-runtime service-account class + distinct token
audience, the launcher's selectable identity profile, and separate personal and managed warm pools
that run the `apps/agent-runtime` image), execution authority via the durable ToolInvocation
lifecycle and the MCP-specific OCI executor (provider addressing and credentials never enter a
runtime Pod), the scoped-memory
contract freezes the gateway-native dataset selected by admitted authority while the authenticated
read transport returns through the same durable attempt-fenced result delivery, and the
attach authority plus the central runtime authorization/grant intersection (closes the slice-5
deferral; scope isolation tested). Scoped injection and personal record/correct/forget remain
fail-closed pending a durable,
recoverable gateway write lifecycle. Live qualification must prove the harvesting central agent
against the admitted MCP revision and immutable executor path; the repository does not retain an
Obot fallback beside that acceptance gate.

Here, **built and CI-qualified** means the source, contracts, fault tests, and rendered deployment
artifacts pass without depending on a live external environment. It does not mean PostgreSQL,
Kubernetes Jobs, LiteLLM, OCI MCP execution, Zitadel login, TLS, recovery, or isolation have passed together on a
real cluster.

**Live qualification status (2026-08-06):** the app-owned Terraform path created the regional
Autopilot cluster `opencrane-dev` wholly in `europe-west1`; ingress-nginx, cert-manager, and
CloudNativePG are live and Ready through the locked prerequisite bootstrap. The dedicated
`testv2.dev.opencrane.ai` record resolves publicly to the reserved ingress address, the confidential
Zitadel OIDC application and client Secret are configured, and the namespace now has four distinct
PostgreSQL bootstrap Secrets. The corrected deploy preflight accepts `dev.opencrane.ai` as the
authoritative record subtree (not a separately delegated child zone), and `standard-rwo` is the
default expandable class. GKE reports regional SSD quota at `230/500 GiB` (270 GiB free); the
project has no default Compute Engine KMS key, so this deployment cannot qualify the CMEK
durable-storage gate.

The first real `testv2` release created and kept its namespace, CNPG Cluster/PgBouncer, ingress,
certificate, UI, Cognee, LiteLLM, and the then-current Obot gateway that 0.10 later retired. PostgreSQL and its original privileges hook
completed. The release exposed an invalid architecture assumption: its server treated every silo as
Fleet-attached and required an external `public-key.pem`, despite this test being a standalone
ClusterTenant. The deployment contract now has explicit `standalone` and `fleet` membership modes;
`standalone` removes the Fleet Secret/key mount and starts without converting an OIDC session into
membership, so runtime admission remains fail-closed until a local issuer is built. The initial
channel-proxy and memory-gateway image references did not exist. CI now publishes both from `d2f26df0` under immutable
`sha-d2f26df0` tags, and the complete CI run is green, including Terraform's read-only provider
lock validation.

The server-image CI is now green and published immutable `sha-ffc4dfc`. The live single-silo
deployment is healthy: the app-owned deploy script uses current chart sources rather than stale
local archives; all server database clients use the CNPG Pooler ClusterIP; GKE Dataplane V2 admits
that Service and DNS through port-limited egress while the Pooler ingress policy names its three
approved clients. The server is Ready with a healthy Prisma query, public `/healthz` returns
`{"status":"ok","db":true}`, and its liveness no longer restarts an otherwise recoverable database
path. `testv2.dev.opencrane.ai` now has a browser-trusted Let's Encrypt HTTP-01 certificate and the
login endpoint redirects to the configured Zitadel confidential client. The privileges proof remains
intact: the historical three-container Job completed after Autopilot provisioned its isolated
ComputeClass node; that cold-node and image-pull delay was operational friction, not an application
memory leak. The current chart runs two PostgreSQL client containers through ordinary Autopilot
scheduling, each with 50 millicores of processor time and 64 mebibytes of memory. The final
monthly cost, CMEK durable-storage gate, browser completion of the Zitadel callback, runtime-job
execution/isolation, local standalone membership issuer for runnable personal/managed agents, and
the wider Phase E live-LiteLLM/OCI-MCP/recovery qualification remain open live gates.

**Live single-silo update (2026-08-07):** `testv2` now runs OpenCrane Helm revision 32 and PostgreSQL
revision 49. The CI-published server image `sha-fc53af6` and artifact-service image `sha-7ebcfa8`
are Ready; every deployment is Available, and public `/healthz` returns
`{"status":"ok","db":true}` and `/api/v1/auth/login` redirects to the configured Zitadel confidential
client. The immutable standalone first-owner contract is live: only the verified
`jente@elewa.ke` subject from `https://weownai-oidc-8dwlat.eu1.zitadel.cloud/` may create the local
Owner membership for ClusterTenant `testv2`; it creates the membership and its audit record in one
transaction. A real callback exposed and the regression test now prevents a Prisma selector from
including the in-memory `mayCreateOwner` authorization flag; the corrected image is live. The
deployment also retains the existing OIDC Secret and seeds OpenAI through LiteLLM.
This clears the single-silo deployment, TLS, OIDC configuration, database-privileges, initial-provider,
local first-owner admission, and full workload-health gates. A real callback returned successfully and
created the active `testv2` Owner row. Its first rendered `/no-tenant` page was a separately stale SPA
(`latest`) calling a removed endpoint; CI now publishes the UI on demand and Helm revision 33 pins
`opencrane-ui:sha-6a09541`. Personal-agent/workspace creation and Phase E runtime qualification remain
open live gates.

**Live silo update (2026-08-10):** `testv3` is now the active development silo. Its tenant-prefixed
main, artifact, skill-authoring, and tool namespaces remain deployed and every application,
PostgreSQL, pooler, and dynamic MCP workload is Ready/Running. The superseded `testv2` DNS and
Zitadel callback/origin/logout entries were retired, then its four legacy namespaces were deleted
through a reviewed, UID- and full-inventory-bound app-owned retirement path. The one-time legacy
script was removed after its evidence was recorded in the deploy ledger.

Repository train `0.8.0` also replaces the earlier fresh-database-only decision with explicit
version-to-version authority. Every Nx application records the last root train that adapted its
production contract, directly or through its dependency graph; immutable release manifests map the
compatible app, chart, and database revisions. Adjacent minor trains carry reviewed Helm transitions
and a bounded database migration Job. The deferred migration hardening work is tracked in #699.
The `0.7.0` to `0.8.0` SQL path migrates empty legacy persona state automatically and fails
closed with `OC708` when semantic mapping of populated persona data requires an operator-reviewed
manual plan.

Exit: the canonical runtime and managed-agent lifecycle pass failure, replay, authorization,
isolation, cancellation, provider, and artifact tests with no OpenClaw compatibility surface.

### Cross-cutting track — central durable authorization authority

**Status: IN PROGRESS — follow-up to #745; blocks code-skill execution and complete package-authority convergence.**

Replace the repository's separate product-authorization paths with one logical
`AuthorizationAuthority`. The authority is a transaction-bound application port backed by the silo
PostgreSQL database, not a separate network service: the authorization decision, protected product
write, and one-use effect admission must commit or roll back together.

Authentication, workload identity, lifecycle eligibility, and product authorization remain distinct:

- OIDC and membership prove which human or service is calling;
- Kubernetes TokenReview proves the controller or Pod identity assigned to admitted work;
- domain owners decide whether a revision is operationally eligible, such as an MCP revision being
  Ready or a skill revision being Published;
- the central authority alone decides whether a principal may perform the product action; and
- NetworkPolicy and Kubernetes RBAC constrain infrastructure reachability but never grant product
  permission.

Humans, Groups, managed `AgentService` principals, and personal-agent runs use the same grant
semantics. A managed agent's resource grants and a human caller's permission to invoke or administer
that agent are separate decisions. A personal agent uses its human principal's current grants
intersected with its approved revision and frozen run ceilings. Frozen state is a maximum, not a
permanent grant: revocation or membership loss denies the next external effect.

#### Adoption and deletion chain

Deliver the track in this one follow-up PR through internally gated waves and commits. Each wave
adopts a bounded caller set and deletes what it replaces before the next wave starts.

1. Inventory every route, use case, background consumer, and executor that makes a product
   permission decision. Record its actor, resource, action, current guard, target authority call,
   eligibility owner, and receipt need. Add a checked enforcement inventory and forbid new raw role,
   owner, silo, visibility, or product-specific entitlement guards.
2. Harden the common authorization kernel with typed resources and actions, principal and Group
   resolution, deny precedence, expiry, batch catalogue filtering, transaction-bound effect
   admission, durable decision evidence, and safe decision explanations.
3. Adopt human and agent management. Gate agent discovery, creation, revision, publication,
   invocation, scheduling, delegation, retirement, and administration through the authority. Treat
   managed agents as durable Principals and personal runs as the human-principal intersection.
4. Converge governed packages. Move MCP and skill discovery, assignment, publication, installation,
   and use to the shared authority. Keep their lifecycle and executor rules separate. Delete MCP-only
   access reconciliation, owner-only skill execution, and silo-wide skill visibility as their callers
   move.
5. Adopt artifacts, conversations, datasets and memory, models, provider connections, channel
   targets, schedules, budgets, approvals, and child-run delegation. Recheck current grants before
   every external effect and bind the principal, revision, arguments, approval subject, and workload
   assignment into a one-use admission record.
6. Reduce workload authorization to assignment proof. Controllers and Pods may exercise the exact
   admitted action or fail closed; they may not reinterpret grants, membership, ownership, or roles.
7. Delete `_RequireOrgAdmin`, owner-or-silo shortcuts, visibility-as-permission checks,
   package-specific entitlement engines, duplicate evaluators, direct product role checks, and every
   stale schema, configuration, API, UI, test, export, dependency, and document they leave behind.
   Bootstrap ordinary owner/admin product powers as managed grants. Retain only separately documented
   cluster bootstrap or operator controls that are not product authorization.
8. Qualify direct humans, inherited Groups, managed agents, personal runs, delegated runs, and
   workloads. Cover wrong silo/principal/agent, stale membership, deny precedence, expiry, nested
   Groups, revocation, lifecycle changes, altered arguments, replay, cancellation, approval mismatch,
   and transaction failure. Prove grant → attach → publish → invoke → revoke → next effect denied,
   plus clean installation and the supported predecessor upgrade for any schema change.

Each wave names its survivor and deletion sets before implementation, reads
`docs/agents/versioning.md`, updates fresh and upgrade paths together, runs architecture and reaper
before and after structural work, and closes with focused tests. The PR closes with independent
review, residue cleanup, and the comments gate. Do not add compatibility shims, dual policy
evaluation, or delayed cleanup.

Exit: every product permission decision uses the central authority port; humans and agents share one
grant model; external effects have replay-safe ToolInvocation admissions and durable authorization
evidence; revocation takes effect at
the next external boundary; CI rejects bypasses; and no replaced authorization code, data,
configuration, API, UI, test, or documentation remains.

### Phase F — product and operator surfaces

Deliver one OpenCrane API/UI for conversation, persona, memory, agent catalog and revisions,
schedules and runs, approvals, assets, skills, membership, effective-access explanation, audit,
health, model/cost/budget, and runtime versions
([#224](https://github.com/elewa-git/opencrane/issues/224),
[#226](https://github.com/elewa-git/opencrane/issues/226)). Upstream consoles remain diagnostic.

**Current implementation status:** the Angular shell has same-origin OIDC/session guards and early
operator screens for catalogue and model keys. The former access-policy screen and MCP-only access
API were removed; generic grant administration remains a blocked successor. Persona sorting now
runs through the target API and authoritative `/onboarding` shell: an owner can answer the reviewed
interview, resolve ties, inspect the derived immutable persona, and approve it into durable onboarding
state. Bootstrap chat, main-app admission and fencing, conversation/thread/prompt streaming, memory,
run history, schedules, membership, audit, assets, skills, and the remaining approval journeys are
still incomplete. Tool/OAuth success is not backed by the real exchange, and there is no full
route-level browser end-to-end suite. The production Angular build, focused feature tests, and
Storybook regression catalogue are green, but they do not qualify the remaining product journeys.

#### Track F1 — conversation workspace, modes, and Agent threads

Build the first post-onboarding workspace as one durable **Conversation** product with three
immutable modes. The user-facing navigation calls the aggregate a **Chat**; `agent_session`,
`direct`, and `group` remain explicit domain modes rather than inferred UI states.

The accepted product contract is:

- `agent_session` routes every user, agent, tool, asset, elicitation, and A2UI interaction through
  run authority. It admits one foreground run at a time; elicitation and steering continue that run,
  while later questions create serial follow-up runs.
- `direct` and ordinary `group` messages are durable conversation messages and never create fake
  `AgentRun` records.
- an authorized `@agent` message in a group creates one linked child Conversation in
  `agent_session` mode and its first run. The UI calls this an **Agent thread**, not a subagent.
- the child freezes the approved persona of the participant who wrote the `@agent` message. It never
  attaches that participant's personal memory automatically; memory use requires an explicit ask
  that warns approved memory-derived content will be visible to the active parent participants.
  Child visibility mirrors those active parent participants.
- an Agent thread can communicate status, questions, approvals, safe results, failures, and durable
  asset references to its immediate parent through typed, append-only, idempotent delivery. Runtime
  subagents and recursive governed child runs remain the separate authority in
  [#320](https://github.com/elewa-git/opencrane/issues/320).
- the parent shows a compact Slack-style thread summary. Opening it replaces the main transcript
  with a stable, deep-linkable child route and breadcrumbs; returning restores the exact parent
  message and scroll position. There is no separate window and no side-panel-only child experience.
- completed onboarding becomes a closed/read-only conversation in normal history. Completion never
  reopens; archive remains a separate user-applied visibility state.
- attached and agent-created assets have distinct provenance. A created asset becomes durable only
  after finalization and survives retry, refresh, and conversation closure.
- one message admits at most ten files sharing a 200 MB total limit. A dedicated scanner must pass
  each file before use. One server-issued output ticket can finalize exactly one generated asset;
  reconnect returns the same asset and conflicting bytes fail visibly.
- tool failure remains visible while retrying and after recovery. Plain-language state is primary;
  sanitized tool, error category, provider response, time, and retry details are progressively
  disclosed. Tokens, credentials, cookies, authorization headers, keys, proofs, and raw secrets never
  reach the browser.
- retry internal preparation at most three times within five minutes, and only before a provider
  request starts. After dispatch, replay a saved success or check the provider when that is possible.
  If neither can prove the outcome, never guess or send the action again: stop the run in a visible,
  cancellable **Needs recovery** state.
- #319 owns the durable recovery state, sanitized stream projection, and expected-attempt-fenced
  cancellation API. The deployed SPA still has no conversation workspace route, so the actual
  **Needs recovery** card and cancel control mount with the workspace in #351; #319 must not claim
  that an unmounted reducer or Storybook fixture is already user-visible.
- one recoverable elicitation contract renders approvals, single choice, multiple choice, and bounded
  free text, including explicit personal-memory permission. Consequential A2UI actions use that
  authority; rendered UI never grants permission.

The accepted paper/origami workspace language remains the visual source. The repository-owned
[canonical design context target](./docs/ui-design/README.md) contains the current workspace, A2UI,
and Agent-thread boards plus stable issue-specific screenshot extracts. Its finite-state supplement
now resolves queued admission, unauthorized or revoked access, deep-linked ask landing, reconnect,
asset removal/availability, bounded elicitation, immutable route coordinates, orthogonal summary
state, production focus, and the A2UI count/protocol decision. The retained A2UI sink is re-pinned
directly to supported upstream A2UI packages and loses its OpenClaw lockstep. F1.1 is closed: the
component-manager validated the supplement against the live catalogue and returned `PASS` on
2026-08-10. The matching product contract is frozen in
[workspace and conversation user stories](./docs/user-stories/workspace-and-conversations.md) and
[ADR 0012](./docs/adr/0012-conversation-modes-and-agent-thread-authority.md).

| Step | Outcome | Owning GitHub issues | Exit gate |
|---|---|---|---|
| F1.1 — model and design contract | Freeze mode vocabulary, strategy ownership, lifecycle, parent/child coordinates, terminology, route hierarchy, finite visual states, and the no-secret disclosure contract | [#600](https://github.com/elewa-git/opencrane/issues/600), [#601](https://github.com/elewa-git/opencrane/issues/601), [#351](https://github.com/elewa-git/opencrane/issues/351) | User stories, architecture decision, component/state map, and committed desktop/compact wireframes agree before schema or routed-page work starts |
| F1.2 — conversation authority and ordinary messaging | Add immutable modes, mode strategies, conditional agent binding, participant/join authority, canonical mixed timeline, list/create/open APIs, and idempotent direct/group message admission | [#600](https://github.com/elewa-git/opencrane/issues/600) | Agent-session input cannot bypass runs; ordinary direct/group messages cannot create runs; foreign, closed, wrong-mode, and replay attempts fail closed |
| F1.3 — onboarding handoff — **IN PROGRESS** | Retain the completed bootstrap exchange as the selected closed/read-only workspace conversation, atomically materialise the first personal Agent revision, repair earlier completed users, and expose Start a new chat without rewriting onboarding evidence | [#602](https://github.com/elewa-git/opencrane/issues/602), [#351](https://github.com/elewa-git/opencrane/issues/351) | Completion, personal-Agent readiness, refresh, direct navigation, attempted write, and incomplete-user API/route denial pass end to end |
| F1.4 — canonical live delivery — **IN PROGRESS** | Extend finite replay into authorized snapshot-to-live conversation delivery across ordinary messages and run events; pin AG-UI, reconnect/interrupt semantics, terminal projection, and the versioned A2UI envelope | [#319](https://github.com/elewa-git/opencrane/issues/319), [#351](https://github.com/elewa-git/opencrane/issues/351) | No gaps or duplicates; opaque cursors recover open elicitation; failure/cancellation stay truthful; raw authority/runtime payloads remain server-side |
| F1.5 — group Agent threads and parent communication | Admit `@agent`, create the child agent session, stream its serial runs, project the parent summary, deliver safe results upward, and navigate through stable breadcrumbs | [#601](https://github.com/elewa-git/opencrane/issues/601), [#351](https://github.com/elewa-git/opencrane/issues/351) | One mention creates one child and first run; parent/child keep independent history and unread state; access loss, deep links, back/scroll restoration, and immediate-parent-only delivery pass |
| F1.6 — conversation assets — **IN PROGRESS** | Add governed upload/attach/preview/download, finalized agent-output receipts, inline asset cards, and the Files index | [#603](https://github.com/elewa-git/opencrane/issues/603), [#351](https://github.com/elewa-git/opencrane/issues/351) | Upload, scan/process, failure/retry, inaccessible/expired, ready, and durable-created-output journeys pass without exposing storage internals |
| F1.7 — tools, elicitation, approvals, and A2UI — **CORE COMPLETE; MOUNT IN #351** | Render honest tool/retry state with sanitized disclosure; unify approval, single-choice, multiple-choice, and free-text requests; route A2UI actions through authenticated command authority | [#604](https://github.com/elewa-git/opencrane/issues/604), [#319](https://github.com/elewa-git/opencrane/issues/319), [#351](https://github.com/elewa-git/opencrane/issues/351) | #604's authority, API, generated client, reusable components, recovery store, Activity projection, and visual states pass; #351 mounts them in the production workspace and completes route-level accessibility qualification |
| F1.8 — workspace composition | Mount the authenticated Chats rail, mode-aware transcript/composer, closed states, participant controls, Agent-thread summaries/routes, Files, and Activity through thin pages, a feature store, pure mappers, and approved components | [#351](https://github.com/elewa-git/opencrane/issues/351), [#600](https://github.com/elewa-git/opencrane/issues/600), [#601](https://github.com/elewa-git/opencrane/issues/601) | Production has no mock gateway or alternate renderer; desktop/compact layouts, empty/unavailable/no-agent states, long/hostile content, and mode-specific commands pass Storybook and route-level Playwright |
| F1.9 — delivery and qualification — **IN PROGRESS** | Publish the SPA by an immutable OCI digest with the server/contracts it consumes, reject a stale or unavailable rollout, and qualify login → onboarding → workspace, direct/group chat, Agent thread, live reconnect, assets, elicitation, A2UI, cancellation, and retry | [#351](https://github.com/elewa-git/opencrane/issues/351), [#162](https://github.com/elewa-git/opencrane/issues/162) | Reviewed version/migration evidence is complete; live desired/observed digest and replica evidence match; the named journeys pass against target APIs with no mock or legacy transport |

##### Track F1 execution and PR order

The implementation unit is one vertical, full-stack feature PR per owning issue. A PR can reference
a dependency or consumer issue, but must not close or absorb another issue's feature slice. The
review order follows the real branch ancestry and incremental diff, not merely this table:

1. Land the current design-context and planning preflight without claiming an implemented feature,
   then close the explicit F1.1 design gates before starting #600 production work.
2. **[#600](https://github.com/elewa-git/opencrane/issues/600)** — establish Conversation modes,
   strategy ownership, canonical timeline, membership, and ordinary direct/group messaging.
3. After #600, execute **[#319](https://github.com/elewa-git/opencrane/issues/319)** —
   snapshot-to-live delivery, reconnect, truthful terminal projection, interrupts, and the
   versioned A2UI envelope. Architecture preflight found that #602 cannot pass its route and direct
   navigation acceptance before #351 mounts the workspace shell; do not ship a partial redirect or
   an unmounted onboarding pane.
4. After #319, execute these independent branches in parallel when capacity permits:
   - **[#603](https://github.com/elewa-git/opencrane/issues/603)** — governed attachments, finalized
     outputs, transcript asset events, and Files;
   - **[#604](https://github.com/elewa-git/opencrane/issues/604)** — tool disclosure, approvals,
     choices, bounded free text, Activity, and authorized A2UI actions.
5. **[#601](https://github.com/elewa-git/opencrane/issues/601)** — build group Agent threads after
   #600, #319, #603, and #604 provide their reusable conversation, delivery, asset, and elicitation
   contracts.
6. **[#351](https://github.com/elewa-git/opencrane/issues/351)** — compose the authenticated
   workspace and routes after the owning feature PRs expose their production contracts. This PR
   contains integration and remaining shell work, not duplicate implementations of earlier issues.
7. **[#602](https://github.com/elewa-git/opencrane/issues/602)** — complete the onboarding handoff
   against the mounted workspace: retain the immutable bootstrap evidence as closed/read-only
   history, select it after completion, reject writes and runs, and expose Start a new chat.
8. **[#162](https://github.com/elewa-git/opencrane/issues/162)** — qualify the immutable deployed
   SPA and named live journeys after #602. Attach live-only evidence directly to #162; create a
   separate #162 PR only when qualification reveals an owned chart, release, or status change.
   The live generated-output gate must also prove LiteLLM/provider forwarding for the exact pinned
   OpenAI Responses image and code-execution tools, including container-file content retrieval through
   the attempt-scoped virtual key. Offline provider-adapter tests do not satisfy that external proof.

Every feature PR should contain several coherent green commits: model/contracts and version or
migration intent; server authority and adapters; approved components and motion; route/store wiring;
and Storybook, Playwright, negative, and accessibility tests. Commit the first validated slice before
requesting independent review. Review findings are resolved in later `🐛` commits and revalidated;
the branch is not kept uncommitted while waiting for a reviewer. Before publication, re-read the
live PR graph, stack only on genuine dependencies, and prove that each `base...head` diff contains
exactly one issue's incremental work.

Current F1.4 checkpoint: #319 has committed snapshot-to-live replay, reconnect and interrupt
overlays, canonical runtime-event persistence, exact runtime payload contracts, per-approval-batch
resume, truthful tool/run failure projection, governed A2UI and child-run envelopes, stateless
receiver-bound channel relay, and database/release authority. Follow-up commits now make lifecycle
event admission atomic, allow cancellation to supersede stale delivery, retain failed-then-recovered
tool evidence, materialize progressive A2UI surfaces, admit the complete v4 component catalogue,
pass the Linux visual baselines, and prove the projection against the exact pinned AG-UI client.
The latest architecture wave leaves the OpenCrane app as typed assembly only: fixed TokenReview,
signed membership selection, conversation-read policy, exact host binding, and bounded route
reconciliation now live in their owning libraries. A verified producer/consumer mismatch was also
closed by sharing one digest authority between invocation-context issuance and replay consumption;
the raw bearer remains absent from persistence and logs. Focused package tests and policy gates pass
for the committed projection work at this checkpoint.
Durable recovery for irreversible external actions now has product approval: OpenCrane may retry
only bounded internal preparation before dispatch; after dispatch it must replay saved success,
check the provider when supported, or stop visibly in **Needs recovery** without sending the action
again. That recovery model is implemented through a transaction-bound ToolInvocation unit of work:
durable claims, result replay, provider-check strategy, and the visible recovery projection share one
canonical lifecycle authority. Server-owned MCP invocation, credential isolation, safe result
redaction, lifecycle-event ownership, and the provider-free replay digest check are covered by
focused tests. The exact State×Event planner owns every invocation transition; claim kind, fence and
revision prevent overlapping dispatch/reconciliation; approved argument edits become the effective
provider request; and cancellation waits for in-flight claims to settle without admitting new work.
Provider failures now retain failed spans without exporting raw exceptions, idle polls create no
trace noise, and process shutdown aborts external dispatch before draining durable work. Correctness, security,
architecture, observability, and residue rechecks pass; fresh and upgraded 0.8 databases converge
under live PostgreSQL qualification; and package, ownership, style, boundary, and release gates pass.
The legacy 0.7 route-expiry replacement is approved and
implemented: migrated route ids, endpoint/registration coordinates, prior revocation, and exact
expiry evidence survive as permanently inactive rows, while startup reconciliation creates the
sole usable stable receiver route. Fresh 0.8 and migrated 0.7 databases converge under the live
PostgreSQL test. F1.4 remains in progress until the rebased PR head passes live CI and merges. #337
remains LiteLLM-only; #592 tracks live qualification of the OCI-backed MCP replacement.

Track F1 closes [#351](https://github.com/elewa-git/opencrane/issues/351),
[#600](https://github.com/elewa-git/opencrane/issues/600),
[#601](https://github.com/elewa-git/opencrane/issues/601),
[#602](https://github.com/elewa-git/opencrane/issues/602),
[#603](https://github.com/elewa-git/opencrane/issues/603), and
[#604](https://github.com/elewa-git/opencrane/issues/604) only when their live acceptance criteria
pass. It closes [#319](https://github.com/elewa-git/opencrane/issues/319) only if the pinned-client,
interrupt, A2UI, and governed-child-run projection decisions there are all resolved. It advances but
does not by itself close [#162](https://github.com/elewa-git/opencrane/issues/162),
[#318](https://github.com/elewa-git/opencrane/issues/318), or
[#320](https://github.com/elewa-git/opencrane/issues/320): UI delivery covers more product journeys,
configuration materialization remains separate, and runtime child-run delegation is not the same as
a group-created child Conversation.

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
([#227](https://github.com/elewa-git/opencrane/issues/227),
[#231](https://github.com/elewa-git/opencrane/issues/231)). Update README, CHANGELOG, website,
runbooks, generated clients, and CI forbidden-reference checks.

Exit: a fresh checkout builds and deploys only the target product. Operators have one supported path
to create, share, schedule, observe, revoke, and delete agents and assets.

## 0.10.0 workflow cutover

A workflow is saved work that can continue after a server or worker restarts. The 0.10.0 cutover
finishes the move from SQL pollers and locks to Absurd workflows in this order:

1. Finish OCI Image Layout ZIP admission, registry import, and immutable digest persistence
   ([#592](https://github.com/elewa-git/opencrane/issues/592),
   [#741](https://github.com/elewa-git/opencrane/issues/741)).
2. Use that digest for MCP installation and real tool execution through `RuntimeWorkloadClaim`, an
   MCP-specific executor, ToolInvocation, and a class-specific warm pool
   ([#592](https://github.com/elewa-git/opencrane/issues/592),
   [#741](https://github.com/elewa-git/opencrane/issues/741)).
3. Move the existing skill, artifact, and AgentRun lifecycles onto durable tasks, including explicit
   AgentRun wait reasons ([#695](https://github.com/elewa-git/opencrane/issues/695),
   [#736](https://github.com/elewa-git/opencrane/issues/736)).
4. Retire Obot only after OCI-backed MCP installation and execution work
   ([#592](https://github.com/elewa-git/opencrane/issues/592)).
5. Delete MCPB routes, schema, workers, old SQL locks and pollers, and unreachable AgentRun residue
   ([#695](https://github.com/elewa-git/opencrane/issues/695),
   [#740](https://github.com/elewa-git/opencrane/issues/740)).
6. As the final integration step, run the forward 0.9.2-to-0.10.0 change with one dedicated
   migration Job. It carries the tagged release's 0.9.0 schema through the reviewed IAM prerequisite,
   after CloudNativePG has installed `pg_cron` and assigned its schema to the application owner in
   two observed `Database` generations. The Job receives no superuser credential and then uses
   Prisma Migrate as the database-change ledger from 0.10.0 onward. The 0.10.0 release closes
   [#592](https://github.com/elewa-git/opencrane/issues/592),
   [#695](https://github.com/elewa-git/opencrane/issues/695),
   [#736](https://github.com/elewa-git/opencrane/issues/736),
   [#740](https://github.com/elewa-git/opencrane/issues/740), and
   [#741](https://github.com/elewa-git/opencrane/issues/741) only after the full cutover is qualified.

## Open issue disposition

| Issue | Target-state action |
|---|---|
| [#127](https://github.com/elewa-git/opencrane/issues/127) | Keep enforcing CNI, per-silo routing, encrypted-storage preflights, and live probes |
| [#136](https://github.com/elewa-git/opencrane/issues/136) | Defer compute tiers and pooling until measured target workload evidence exists |
| [#154](https://github.com/elewa-git/opencrane/issues/154) | Replace generic plugin-kernel work with concrete app/module contracts |
| [#162](https://github.com/elewa-git/opencrane/issues/162) | Retain target chart-native UI deployment work |
| [#220](https://github.com/elewa-git/opencrane/issues/220) | Delete OpenClaw-specific scope; carry least privilege into target workload profiles |
| [#222](https://github.com/elewa-git/opencrane/issues/222) | Build artifact-backed, scanned, signed, revocable skills and isolated Python execution |
| [#224](https://github.com/elewa-git/opencrane/issues/224) | Build the target model/cost/provider/budget console |
| [#226](https://github.com/elewa-git/opencrane/issues/226) | Build membership management over authoritative target APIs |
| [#227](https://github.com/elewa-git/opencrane/issues/227) | Delete packages and images when their replacement slice lands |
| [#231](https://github.com/elewa-git/opencrane/issues/231) | Introduce final target names directly; do not preserve legacy DNS or aliases |
| [#318](https://github.com/elewa-git/opencrane/issues/318) | Conversation-initiated config changes: always-granted `upgrade_session` tool, logged persona refresh, user-editable params in the product UI |
| [#319](https://github.com/elewa-git/opencrane/issues/319) | Finish authorized snapshot-to-live AG-UI, interrupts, truthful terminal projection, and the versioned A2UI boundary in F1 |
| [#320](https://github.com/elewa-git/opencrane/issues/320) | Keep governed runtime child runs separate from F1 child Conversations; project them only after the explicit #319 decision |
| [#351](https://github.com/elewa-git/opencrane/issues/351) | Deliver and qualify the authenticated conversation workspace through Track F1 |
| [#513](https://github.com/elewa-git/opencrane/issues/513) | Low priority: evaluate LiteLLM-native OTLP GenAI spans through an operator-supplied collector, with message content disabled by default |
| [#592](https://github.com/elewa-git/opencrane/issues/592) | OCI admission, immutable import, MCP executor claims, and Obot retirement are complete in the 0.10 review stack. Keep the issue open for the pre-started generic runtime pool, reconciliation, and live latency qualification. |
| **0.10.0 workflow execution order** | **1.** Let product database transactions declare work that remote workflow workers execute. **2.** Run MCP tools from imported immutable OCI images through an MCP-specific executor and `RuntimeWorkloadClaim`; never put an uploaded image in the fixed generic agent Pod. **3.** Move skill validation, artifact preprocessing, and AgentRun lifecycle onto durable tasks. **4.** Remove each replaced polling, locking, lease, dispatch, MCPB, Obot, and legacy integration path after its durable owner exists. **5.** Finish with the forward database migration and dedicated migration Job. **6.** Run live pickup-latency and deployment qualification on the frozen candidate. |
| **0.10.0 forward workflow cutover** | Move directly from tagged release 0.9.2 to 0.10.0 with one dedicated migration Job. Carry its 0.9.0 database schema through the reviewed IAM prerequisite, then use Prisma Migrate as the ledger from 0.10.0 onward. OCI Image Layout ZIP admission accepts MCP `2026-07-28` only. Keep the remote v2 era-probe workflow and remove the MCPB routes, schema, and workers. The untagged 0.9.3 candidate is not a supported release boundary. |
| [#600](https://github.com/elewa-git/opencrane/issues/600) | Build immutable conversation modes, strategy ownership, ordinary messaging, and the mixed canonical timeline |
| [#601](https://github.com/elewa-git/opencrane/issues/601) | Build group `@agent` child sessions, immediate-parent delivery, compact summaries, and breadcrumb navigation |
| [#602](https://github.com/elewa-git/opencrane/issues/602) | Retain completed onboarding as closed/read-only workspace history |
| [#603](https://github.com/elewa-git/opencrane/issues/603) | Build governed conversation attachments and durable agent-created outputs |
| [#604](https://github.com/elewa-git/opencrane/issues/604) | Build reusable approvals, choices, free-text elicitation, recovery, and safe disclosure |
| [#695](https://github.com/elewa-git/opencrane/issues/695) | The Absurd foundation, OAuth refresh, saved MCP checks, OCI execution, skill and artifact workflows, AgentRun execution, and retirement are complete in the 0.10 review stack. Keep the worktrack open until #592 finishes, the remaining hand-written SQL lock and polling paths have durable owners or the one approved transaction-admission exception, the final Prisma migration is composed as the last implementation step, and live qualification passes. |
| [#736](https://github.com/elewa-git/opencrane/issues/736) | Complete in the 0.10 review stack: explicit wait reasons, encrypted database continuations, exact tool/question links, warm-runtime replacement, and active-call recovery fencing are implemented and tested. Close with the 0.10.0 release after final migration and live qualification. |
| [#740](https://github.com/elewa-git/opencrane/issues/740) | Complete in the 0.10 review stack: unreachable AgentRun cancellation and model-key residue are removed. Close with the 0.10.0 release after live qualification. |
| [#741](https://github.com/elewa-git/opencrane/issues/741) | Functionally complete in the 0.10 review stack: the public task API submits exact installed MCP `2026-07-28` tools, resumes saved input, exposes durable results and failures, and closes controller assignment and readiness races. Close with the 0.10.0 release after final migration and live qualification. |

Closed issues are intentionally absent from the active list: [#128](https://github.com/elewa-git/opencrane/issues/128),
[#129](https://github.com/elewa-git/opencrane/issues/129),
[#133](https://github.com/elewa-git/opencrane/issues/133),
[#150](https://github.com/elewa-git/opencrane/issues/150),
[#174](https://github.com/elewa-git/opencrane/issues/174),
[#221](https://github.com/elewa-git/opencrane/issues/221),
[#225](https://github.com/elewa-git/opencrane/issues/225),
[#255](https://github.com/elewa-git/opencrane/issues/255), and
[#353](https://github.com/elewa-git/opencrane/issues/353).

## Deferred research

- Dedicated compute, pooling, scale-to-zero optimization, and additional guardrail services wait for
  measured target workload, security, and cost evidence.
- A generic plugin framework remains deferred until at least two concrete target modules require the
  same extension seam.
- Lightweight model-call traceability remains deferred to
  [#513](https://github.com/elewa-git/opencrane/issues/513): prefer LiteLLM-native OTLP GenAI spans
  through an operator-supplied collector, with prompt and response content disabled by default.
