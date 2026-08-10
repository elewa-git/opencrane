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
   workload behind a **language-neutral** `AgentRuntimeProtocol v1` ([ADR 0010](docs/adr/0010-language-neutral-agent-runtime.md));
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
   authorization is per silo with proof-bound run/action capabilities; runtimes receive no
   Kubernetes mutation RBAC; Cilium/default-deny enforces workload isolation; Python Jobs are
   isolated; controller and channel-proxy trust boundaries are separate apps; legacy CRDs and
   OpenClaw authorities disappear.

Toolkit selection remains evidence-driven: the offline Phase E conformance harness, immutable
managed run admission and tagged personal/managed input contract, fault-injection matrix,
controller, and runtime boundaries are built and CI-runnable. Live PostgreSQL, Obot, Cognee, and
LiteLLM qualification remains gated on
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
proof-bound capabilities, channel proxy, agent controller, ArtifactStore CAS, outbox, app-owned
Cognee/Obot adapters, default-deny Cilium profiles, workload identities, and deterministic creation
of fresh application stores and credentials. Every durable store uses an expandable mounted volume;
agent-runtime storage is mounted scratch and never the long-term home for user data.

Delete replaced legacy schemas, Tenant/AccessPolicy authority, OpenClaw imports, static agent-token
paths, broad secret broadcasts, obsolete topology switches, and unowned deployables in the same
slices. CI rejects reintroduction. [#117](https://github.com/elewa-git/opencrane/issues/117) supplies
the enforcing-CNI work; [#221](https://github.com/elewa-git/opencrane/issues/221) generalizes the
identity matrix; [#128](https://github.com/elewa-git/opencrane/issues/128) becomes the target Obot
adapter and fresh user-authorized integration flow — seeded by porting PR #241's reviewed Obot
custody/credential/discovery slices from `main` per
[#255](https://github.com/elewa-git/opencrane/issues/255).

Exit: a fresh environment is created from reviewed target artifacts alone; IAM and network negative
tests fail closed; backup/restore reconstructs target-owned stores; no legacy contract is reachable.

### Phase E — personal runtime and AgentService plane (core runtime built; phase incomplete)

**Core runtime built and CI-qualified:** the dependent PR stack now defines immutable run input, the fenced runtime protocol,
the outbound-only runtime process, the suspended one-Job-per-attempt resource contract, and a
crash-safe controller boundary that exactly creates/adopts suspended Jobs before persisting their
Kubernetes UID as the pending assignment. This dependent slice adds a durable release claim,
conditionally unsuspends only that assigned Job, and records its unique first Pod before bootstrap
exchange can begin. A further dependent slice adds cancellation-owned cleanup of abandoned
suspended Jobs: a nonterminal `Cancelling` run state fences the current assignment, proof key, and
pending approvals before any Job is touched; `PrismaRunCancellationRepository` then issues an
assigned or delayed-orphan cleanup claim, and only its confirmed deletion or authoritative absence
moves the run to `Cancelled`. The runtime protocol and channel-target admission fences close on
`cancelling` the same way they close on a terminal state. Bootstrap exchange and the full runtime
command lifecycle now land: the dispatch authority mints `start_attempt`, `resume_attempt`, and a
positive `cancel_attempt` stop signal (with exactly-once terminal reporting under a race); the runtime
surfaces model tool calls as external-action candidates validated against the immutable snapshot and
reserved before dispatch through an injected tool-invocation authority. A tool grant flagged
`requiresApproval` defers: the reserved invocation opens a pending `ApprovalRequest`, so the
pause is reachable end to end. The owner-bound approval-DECISION and steering-INGEST APIs are built:
an owner may decide only their own pending tool approval or queue bounded text only to their own live
run. The deferred-tool DECIDE authority and steering queue feed a fenced, single-use resume command;
the runtime absorbs the queued steering only at safe pre-model boundaries. The
runtime also writes encrypted, version-tagged, replaceable LOCAL checkpoints subordinate to canonical
state (no server-side checkpoint model). The MCP and sandbox execution ports remain fail-closed in
the production composition root. The authenticated memory transport IS composed: the server mounts
its audience-bound projected token and shares one gateway client between admission and dispatch.
Admission-time recall freezes gateway-selected fact references (id + content digest, never text)
into the personal `RunInputSnapshot`, and compile-time statement loading re-resolves and
digest-verifies every reference before inlining it — so redelivered `start_attempt` frames stay
byte-identical or fail closed. Mid-run recall through the external-action executor remains gated:
`AgentRuntimeProtocol v1` has no attempt-fenced ephemeral tool-result channel, and persisted
`ToolInvocation` receipts must not duplicate Cognee fact content. Record, correction, forgetting,
and scoped injection also remain fail-closed pending a recoverable gateway write lifecycle.

**MEMORY TRANSPORT COMPOSED; ADMISSION+COMPILE RECALL LIVE; MID-RUN RECALL AND WRITES STILL GATED**

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
reach external systems only through Obot-custodied MCP servers, instantiable per connected source. The
legacy ingestion interval worker and its direct Cognee writes are deleted.
Conversation-initiated config changes (always-granted `upgrade_session` tool,
logged persona refresh, apply-at-next-snapshot) → [#318](https://github.com/elewa-git/opencrane/issues/318).

**Central-agents sub-lane** (slice 6, [#332](https://github.com/elewa-git/opencrane/issues/332) — closes
[#129](https://github.com/elewa-git/opencrane/issues/129)): BUILT (offline) — the scheduler semantics
(`backend-server-agent-scheduling`, composed inside `apps/opencrane`: cron+timezone eval, missed-run
catch-up, overlap/backoff/suspension, idempotent run creation through the existing
`ManagedRunAdmissionPort` with `trigger: schedule`), the `AgentServiceSchedule` model + management
API, the connector-scoped managed identity (`managed-agent-runtime-*` SA class + distinct token
audience, the launcher's selectable identity profile, and the chart-only `apps/managed-agent-runtime`
plane), execution authority via the reserve-before-dispatch tool boundary with the Obot transports
composed (authenticated custody provisioning + a per-attempt Obot key scoped to the run's MCP server
ids; approved calls execute runtime→Obot directly with digest-only `tool.completed` receipts,
allow-list enforced), the scoped-memory
contract freezes the gateway-native dataset selected by admitted authority while the authenticated
read transport is built but not connected to runtime execution pending attempt-fenced ephemeral
result delivery, and the attach-authority + runtime
effective-access intersection over the grant compiler (closes the slice-5 deferral; scope-isolation
tested). Scoped injection and personal record/correct/forget remain fail-closed pending a durable,
recoverable gateway write lifecycle. NOT done — a NAMED LATER GATE: **create and qualify the harvesting central agent against
live Obot**, tracked under [#337](https://github.com/elewa-git/opencrane/issues/337); the composed
custody + direct attempt-key data plane validates Obot responses defensively until that live
qualification pins the exact shapes. The repository
does not retain an unqualified offline definition alongside that live acceptance gate.

Here, **built and CI-qualified** means the source, contracts, fault tests, and rendered deployment
artifacts pass without depending on a live external environment. It does not mean PostgreSQL,
Kubernetes Jobs, LiteLLM, Obot, Zitadel login, TLS, recovery, or isolation have passed together on a
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
certificate, UI, Cognee, LiteLLM, and Obot gateway. PostgreSQL and its original privileges hook
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
intact: Autopilot provisions its isolated ComputeClass node and the three-container Job completes;
this cold-node/image-pull delay is operational friction, not an application memory leak. The final
monthly cost, CMEK durable-storage gate, browser completion of the Zitadel callback, runtime-job
execution/isolation, local standalone membership issuer for runnable personal/managed agents, and
the wider Phase E live-LiteLLM/Obot/recovery qualification remain open live gates.

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
and a bounded, backup-gated database migration Job. Patch, skipped-minor, and major transitions stay
manual. The `0.7.0` to `0.8.0` SQL path migrates empty legacy persona state automatically and fails
closed with `OC708` when semantic mapping of populated persona data requires an operator-reviewed
manual plan.

Exit: the canonical runtime and managed-agent lifecycle pass failure, replay, authorization,
isolation, cancellation, provider, and artifact tests with no OpenClaw compatibility surface.

### Phase F — product and operator surfaces

Deliver one OpenCrane API/UI for conversation, persona, memory, agent catalog and revisions,
schedules and runs, approvals, assets, skills, membership, effective-access explanation, audit,
health, model/cost/budget, and runtime versions
([#224](https://github.com/elewa-git/opencrane/issues/224),
[#226](https://github.com/elewa-git/opencrane/issues/226)). Upstream consoles remain diagnostic.

**Current implementation status:** the Angular shell has same-origin OIDC/session guards and early
operator screens for catalogue, access policy, and model keys. Persona sorting now runs through the
target API and authoritative `/onboarding` shell: an owner can answer the reviewed
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
- tool failure remains visible while retrying and after recovery. Plain-language state is primary;
  sanitized tool, error category, provider response, time, and retry details are progressively
  disclosed. Tokens, credentials, cookies, authorization headers, keys, proofs, and raw secrets never
  reach the browser.
- one recoverable elicitation contract renders approvals, single choice, multiple choice, and bounded
  free text. Consequential A2UI actions use that authority; rendered UI never grants permission.

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
| F1.3 — onboarding handoff | Retain the completed bootstrap exchange as the selected closed/read-only workspace conversation and expose Start a new chat without rewriting onboarding evidence | [#602](https://github.com/elewa-git/opencrane/issues/602), [#351](https://github.com/elewa-git/opencrane/issues/351) | Completion, refresh, direct navigation, attempted write, and incomplete-user API/route denial pass end to end |
| F1.4 — canonical live delivery | Extend finite replay into authorized snapshot-to-live conversation delivery across ordinary messages and run events; pin AG-UI, reconnect/interrupt semantics, terminal projection, and the versioned A2UI envelope | [#319](https://github.com/elewa-git/opencrane/issues/319), [#351](https://github.com/elewa-git/opencrane/issues/351) | No gaps or duplicates; opaque cursors recover open elicitation; failure/cancellation stay truthful; raw authority/runtime payloads remain server-side |
| F1.5 — group Agent threads and parent communication | Admit `@agent`, create the child agent session, stream its serial runs, project the parent summary, deliver safe results upward, and navigate through stable breadcrumbs | [#601](https://github.com/elewa-git/opencrane/issues/601), [#351](https://github.com/elewa-git/opencrane/issues/351) | One mention creates one child and first run; parent/child keep independent history and unread state; access loss, deep links, back/scroll restoration, and immediate-parent-only delivery pass |
| F1.6 — conversation assets | Add governed upload/attach/preview/download, finalized agent-output receipts, inline asset cards, and the Files index | [#603](https://github.com/elewa-git/opencrane/issues/603), [#351](https://github.com/elewa-git/opencrane/issues/351) | Upload, scan/process, failure/retry, inaccessible/expired, ready, and durable-created-output journeys pass without exposing storage internals |
| F1.7 — tools, elicitation, approvals, and A2UI | Render honest tool/retry state with sanitized disclosure; unify approval, single-choice, multiple-choice, and free-text requests; route A2UI actions through authenticated command authority | [#604](https://github.com/elewa-git/opencrane/issues/604), [#319](https://github.com/elewa-git/opencrane/issues/319), [#351](https://github.com/elewa-git/opencrane/issues/351) | Duplicate, foreign, expired, stale-run, and unauthorized responses fail closed; reconnect restores unresolved input; keyboard, focus, screen-reader, and reduced-motion contracts pass |
| F1.8 — workspace composition | Mount the authenticated Chats rail, mode-aware transcript/composer, closed states, participant controls, Agent-thread summaries/routes, Files, and Activity through thin pages, a feature store, pure mappers, and approved components | [#351](https://github.com/elewa-git/opencrane/issues/351), [#600](https://github.com/elewa-git/opencrane/issues/600), [#601](https://github.com/elewa-git/opencrane/issues/601) | Production has no mock gateway or alternate renderer; desktop/compact layouts, empty/unavailable/no-agent states, long/hostile content, and mode-specific commands pass Storybook and route-level Playwright |
| F1.9 — delivery and qualification | Publish the immutable SPA with the server/contracts it consumes and qualify login → onboarding → workspace, direct/group chat, Agent thread, live reconnect, assets, elicitation, A2UI, cancellation, and retry | [#351](https://github.com/elewa-git/opencrane/issues/351), [#162](https://github.com/elewa-git/opencrane/issues/162) | Reviewed version/migration evidence is complete; live desired/observed versions match; the named journeys pass against target APIs with no mock or legacy transport |

##### Track F1 execution and PR order

The implementation unit is one vertical, full-stack feature PR per owning issue. A PR can reference
a dependency or consumer issue, but must not close or absorb another issue's feature slice. The
review order follows the real branch ancestry and incremental diff, not merely this table:

1. Land the current design-context and planning preflight without claiming an implemented feature,
   then close the explicit F1.1 design gates before starting #600 production work.
2. **[#600](https://github.com/elewa-git/opencrane/issues/600)** — establish Conversation modes,
   strategy ownership, canonical timeline, membership, and ordinary direct/group messaging.
3. After #600, execute these independent branches in parallel when capacity permits:
   - **[#602](https://github.com/elewa-git/opencrane/issues/602)** — onboarding handoff and the
     immutable closed/read-only conversation;
   - **[#319](https://github.com/elewa-git/opencrane/issues/319)** — snapshot-to-live delivery,
     reconnect, truthful terminal projection, interrupts, and the versioned A2UI envelope.
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
7. **[#162](https://github.com/elewa-git/opencrane/issues/162)** — qualify the immutable deployed
   SPA and named live journeys after #351. Attach live-only evidence directly to #162; create a
   separate #162 PR only when qualification reveals an owned chart, release, or status change.

Every feature PR should contain several coherent green commits: model/contracts and version or
migration intent; server authority and adapters; approved components and motion; route/store wiring;
and Storybook, Playwright, negative, and accessibility tests. Commit the first validated slice before
requesting independent review. Review findings are resolved in later `🐛` commits and revalidated;
the branch is not kept uncommitted while waiting for a reviewer. Before publication, re-read the
live PR graph, stack only on genuine dependencies, and prove that each `base...head` diff contains
exactly one issue's incremental work.

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
| [#592](https://github.com/elewa-git/opencrane/issues/592) | Replace retired #128/Obot framing with the MCP 2026-07-28-only plane and warm-path runtime contract |
| [#600](https://github.com/elewa-git/opencrane/issues/600) | Build immutable conversation modes, strategy ownership, ordinary messaging, and the mixed canonical timeline |
| [#601](https://github.com/elewa-git/opencrane/issues/601) | Build group `@agent` child sessions, immediate-parent delivery, compact summaries, and breadcrumb navigation |
| [#602](https://github.com/elewa-git/opencrane/issues/602) | Retain completed onboarding as closed/read-only workspace history |
| [#603](https://github.com/elewa-git/opencrane/issues/603) | Build governed conversation attachments and durable agent-created outputs |
| [#604](https://github.com/elewa-git/opencrane/issues/604) | Build reusable approvals, choices, free-text elicitation, recovery, and safe disclosure |

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
