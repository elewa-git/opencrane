# OpenCrane — Active Plan

## Delivery focus — 2026-09-08

OpenCrane gives people and teams assistants that can work with company knowledge and tools,
while the company controls access, data, and spending. MVP means an employee can join, set up an
assistant, get useful work done, and collaborate in a group without understanding the runtime.

The current review surface is [#826](https://github.com/elewa-git/opencrane/pull/826), based on
`develop`. Its 0.11 conversation history and computer baseline is implemented; it is not yet a
live-qualified MVP. [ADR 0016](docs/adr/0016-conversation-history-and-computers.md) supersedes the
older run-owned runtime and relational transcript descriptions in historical plans.

| Work | State and next proof |
| --- | --- |
| Repair #772's obsolete stack ancestry | ✅ COMPLETE — independent patch targets `develop`; see [completed work](plan-done.md). |
| Make development checks proportional to the change | ✅ COMPLETE — early boundaries, scoped reviews, usable caches and isolated Helm fixtures; see [completed work](plan-done.md). Measure gains on comparable runs; active local Stop hooks are unchanged. |
| Explain the product and architecture consistently | ✅ COMPLETE — vision-led README, architecture and website with built/pending status; see [completed work](plan-done.md). |
| Complete the first personal-assistant text journey | ✅ COMPLETE on `232d55d5a` — two employees received answers with approved settings and recovered them in fresh browsers; see [completed work](plan-done.md). |
| Make new sessions and ordinary group chats usable | ✅ COMPLETE for creation, retry, ordered messages and saved history; see [completed work](plan-done.md). Login continuity and live membership-revocation proof remain below. |
| Ask a company assistant to work inside a group | ✅ COMPLETE on `232d55d5a` — three-person audience, initial/follow-up answers, browser navigation and edited human sharing; see [completed work](plan-done.md). Autonomous subagents remain separate work. |
| Rebuild channel event reads (#827) | ✅ COMPLETE — real KurrentDB CI and live multi-user SSE cursor resume pass; see [completed work](plan-done.md). Initial-history and periodic computer replay costs remain to measure. |
| Qualify backup and restore on testv5 | ✅ COMPLETE for the requested drills — scheduled file-copy `latest` recovery, restricted anonymous health and scheduled volume-snapshot backups pass; see [completed work](plan-done.md) and the [deploy ledger](docs/agents/deploy-ledger.md). |

Completed implementation moves to `plan-done.md`; live evidence belongs in
[`docs/agents/deploy-ledger.md`](docs/agents/deploy-ledger.md). A green test, a pushed change, a
deployed image, and a proven user journey are separate facts.

## Rebuild the local-development stack

The closed proposals [#702](https://github.com/elewa-git/opencrane/pull/702),
[#713](https://github.com/elewa-git/opencrane/pull/713), and
[#737](https://github.com/elewa-git/opencrane/pull/737) are behavioural references, not branches to
revive. Rebuild their useful developer journeys as three independently usable pull requests from
the current fresh-install baseline:

```text
develop
  -> Tier 1: frontend-only onboarding and conversation fixtures
       -> Tier 2: local application profiles
            -> Tier 3: k3d and Codespaces qualification
```

The replacement must not restore database migrations, release transitions, channel-proxy, the
retired warm runtime, Obot, relational conversation history, or other 0.10 compatibility paths.
PostgreSQL remains product authority, KurrentDB remains canonical conversation history, and Agent
Sandbox remains the Kubernetes computer boundary.

| Slice | State and acceptance |
| --- | --- |
| Local Tier 1 — frontend-only development | READY FOR REVIEW from current `develop` — plain `npm run serve:opencrane-ui` enters onboarding; the `commander`, `catalyst`, `anchor`, and `analyst` commands open the matching reviewed archetype conversation. Current routed components and state ports run over one backend-free in-memory profile, with deterministic failure/recovery scenarios and a network tripwire. Local state, UI, gateway, Storybook, documentation, boundary and all seven Angular build gates pass; independent architecture, correctness, residue and contract-verification gates pass. Remote CI remains pending on the successor PR. |
| Local Tier 2 — application development | READY FOR REVIEW after Tier 1 — `npm run dev:tier2` is the `core` profile and starts the current server, UI, PostgreSQL clean baseline, and KurrentDB. `npm run dev:tier2:agent` adds the current Conversation Computer through a local development supervisor; `npm run dev:tier2:agent:local-llm`, `:remote-llm`, and `:simulated-llm` retain the three explicit model alternatives without claiming Kubernetes isolation. Abort, stop, suspend, failed startup, lease expiry, and the next launch clean only exactly owned processes, containers, networks, and disposable secrets while retaining and reporting cleanup failures. `--reset` recreates the paired PostgreSQL/KurrentDB fresh baseline; it never upgrades it. The affected Nx build, test and lint gate; focused local-development, UI, OpenCrane, host-process, Helm and KurrentDB checks; repository boundary and style checks; website build; architecture, deletion, and independent review gates pass. Remote CI remains pending on the successor PR. |
| Local Tier 3 — k3d and Codespaces | PLANNED after reviewed Tier 2 — `npm run dev:tier3` remains the short alias for the credential-free `npm run dev:tier3:infra` profile, which proves the current silo, PostgreSQL, KurrentDB, Cognee, LiteLLM, Agent Sandbox prerequisites, ingress, storage, and browser routing without provider credentials. `npm run dev:tier3:agent` adds one governed provider setup and one current Agent Sandbox conversation turn. Minimum host target is 4 cores, 16 GB memory, and 32 GB storage; recommended is 8 cores, 32 GB memory, and 64 GB storage. The minimum-host flow must report a measured storage shortfall instead of deleting unrelated dependencies, caches, clusters, or developer state. |

Each parent head is frozen, validated, independently reviewed, and checked against the live pull-
request graph before its child branches. If the Tier 3 minimum cannot pass without deleting
unrelated developer state, report the measured shortfall for a product decision instead of pruning
that state or silently raising the requirement.

## The MVP we are working toward

An employee signs in, reviews how their assistant should work, starts a conversation, and gets a
useful answer using permitted company knowledge and tools. Colleagues can talk in a group and ask
a shared assistant to do work in a visible child chat. A person can review an action, inspect its
result, and return after a refresh or interrupted session without losing the work. Administrators
control membership, tools, model providers, permissions and spending through OpenCrane.

The accepted [product contract](docs/design/personal-agent-platform-product-contract.md) and
[workspace user stories](docs/user-stories/workspace-and-conversations.md) define the detailed
acceptance criteria. This file records current sequencing; historical implementation narratives
belong in [plan-done.md](plan-done.md) and git history.
ADR 0016 supersedes transport, storage and runtime clauses in older product documents; their user
outcomes remain the acceptance targets.

## Built in the 0.11 review baseline

[PR #826](https://github.com/elewa-git/opencrane/pull/826) is the single review surface for the
conversation-computer replacement. Earlier stack branches are absorbed and closed. The separate
Nx skills PR [#772](https://github.com/elewa-git/opencrane/pull/772) now targets `develop` directly.

- Conversations have immutable KurrentDB history and encrypted private payload references.
- PostgreSQL remains the only current authorization authority. Read projections never grant access.
- Each assistant conversation has one logical computer; Agent Sandbox owns its Pod lifecycle.
- Activation delivery, generation-bound leases, renewal, retries, parked replay, checkpointing and
  cooling have their target owners. The old run-owned warm runtime and relational transcript paths
  are deleted.
- A personal conversation can perform a bounded model turn and persist its output. Approved persona
  instructions now reach the model. Governed tool execution is not yet connected to that model loop.
- Authorized participants have file, diff and browser discovery routes. Commands, screenshots,
  page creation and preview effects remain denied until concrete effect admission is connected.
  Published applications, interactive desktops and unrestricted terminals are absent.
- Backup schedules, restore tooling, HTTPS probes and disruption protection are implemented.
  Scheduled file-copy recovery and volume-snapshot backup creation pass live. Snapshot restore
  remains unqualified; it was additional to the requested backup-mode trial.

The baseline uses fresh installation only. There is no migration, dual-write mode, compatibility
route, or second Pod controller. [ADR 0016](docs/adr/0016-conversation-history-and-computers.md)
supersedes older runtime, storage and upgrade descriptions. Source completion, CI, deployment and
live product acceptance remain separate evidence.

## 0.12 and remaining MVP delivery

The accepted [delivery plan](docs/design/mvp-delivery-plan.md) turns the remaining scope into
bounded PRs, owners, dependencies and acceptance criteria. 0.12 aims to let a personal or company
assistant retrieve permitted company data and complete a precise human-approved action. Memory,
files, autonomous delegation, schedules, administration and operational qualification each retain
their own completion track; they are not silently bundled into the first tool PR.

| Slice | Current state |
| --- | --- |
| C0 — close the replay-contract CI failure on #826 | ✅ COMPLETE in `77a1cdaa6` — focused replay contracts and independent review pass; [Linux CI](https://github.com/elewa-git/opencrane/actions/runs/34267589926), k3d and publication are green. |
| R2 — visible personal activity | ✅ COMPLETE in [#829](https://github.com/elewa-git/opencrane/pull/829). UI `6692b2e59` and server `e50cdcc5b` are installed on testv5. Linux CI and publication pass. Two employees see their completed work, open its saved answer by keyboard, refresh without starting work, and recover activity after reload. Narrow-screen focus and cross-employee API isolation pass. See [completed work](plan-done.md) and the [deploy ledger](docs/agents/deploy-ledger.md). |
| R1 — reliable login | IMPLEMENTED, CI GREEN at `44fd8f328` — encrypted PostgreSQL sessions, fixed deadlines, revision-checked saves and logout markers. All 52 auth tests and [CI](https://github.com/elewa-git/opencrane/actions/runs/34274625541) pass, including all seven SQL targets on fresh PostgreSQL and six real-client session proofs. Fresh-install live qualification remains pending; testv5 retains the earlier database baseline. |
| A1 — membership revocation and closed-work proof | PLANNED — current authority operation and product surface, followed by real-account browser proof. |
| T1 — first permitted tool retrieval | IN PROGRESS in [#830](https://github.com/elewa-git/opencrane/pull/830). Text checkpoint `378a755b6` passes [full CI](https://github.com/elewa-git/opencrane/actions/runs/34300559935), including all seven fresh PostgreSQL targets and 24 real KurrentDB cases (7 conversation and 17 adapter); corrected PR metadata passes [topology CI](https://github.com/elewa-git/opencrane/actions/runs/34301556387). The continuation implementation in this PR may select one frozen tool requiring no approval, retain its declaration privately, check the exact result through IAM and reserve one final text request before acknowledging delivery. It reuses the original key and subtracts the whole first token reservation; restart cannot replenish either allowance. Local checks pass with 437 conversation tests, 136 application tests and both lint targets. Independent review passes; this continuation awaits CI and live qualification. Intermediate participant tool progress, visible recovery and approved actions remain unfinished. Company revisions still exclude tool assignments. None of these T1 changes is live on testv5, which has no installed integration; a dedicated permitted retrieval fixture and complete journey proof are still required. |
| T2/T3/U1 — approved actions and visible recovery | DEPENDS ON T1 — exact approval, cancellation, uncertain outcomes, retries and accessible workspace controls. |
| M1/F1 — explicit memory and durable files | MEMORY PREFLIGHT COMPLETE — recall transport exists, but dataset preparation and remote write/correct/forget are unimplemented. Verify pinned Cognee record identity and idempotency before completing gateway writes. Files retain their independent artifact and reload acceptance track. |
| D1/S1 — autonomous delegation and shared schedules | DEPENDS ON ACTION CONTRACTS — bounded authority, budgets, cancellation and durable results. |
| A2/Q1 — administration and operational acceptance | PLANNED THROUGHOUT — extend protected product surfaces and prove each newly landed journey. |

The overnight run on 8–9 September continues these slices in dependency order and hands off at
08:00 Nairobi time. It commits and pushes reviewed progress, maintains incremental PRs and records
blockers without treating the whole MVP as a one-night promise. See the delivery plan for the
morning checkpoint and operating boundaries.

## Extend the proven text journeys

The completed personal and group-assistant text path is recorded in [plan-done.md](plan-done.md).
The remaining acceptance work is broader than producing a first answer:

| Journey | Remaining work | Acceptance |
| --- | --- | --- |
| Keep login and activity continuous | Qualify the implemented PostgreSQL sessions on a fresh installation; new personal activity is proven. | Server replacement preserves login; people can find newly admitted completed work, with current access checked on every read. |
| Preserve access changes and closed work | Expose the required membership/participant operation and qualify revocation, browser purge and closure with real accounts. | Revoked or closed work stays inaccessible; late responses cannot restore its private history or draft. |
| Follow long conversations efficiently | Measure initial-history and periodic computer replay cost after the completed [#827](https://github.com/elewa-git/opencrane/issues/827) stream. | Long history has bounded read cost; reconnect retains ordered delivery and current access checks. |
| Perform a useful external action | Connect model tool requests to existing server-owned tool admission, approvals, execution and durable results. | One real task succeeds with a chosen integration; denied/revoked/ambiguous actions never execute or claim success. |

Group child chats and runtime delegation are distinct. [ADR 0012](docs/adr/0012-conversation-modes-and-agent-thread-authority.md)
requires a durable child conversation with independent access and history. The implemented human
request records its command and fixed audience with a recovery task, establishes cold history under
ADR 0016, then projects the child and commits its first message with activation. Only completed
creation becomes Ready. The company assistant uses its own managed identity and model permission;
the human requester's current membership and invocation permission remain separate requirements.
Runtime subagents
([#320](https://github.com/elewa-git/opencrane/issues/320)) require explicit parent-run delegation,
budget, cancellation and result ownership and remain later work. Neither journey may silently
inherit a person's private tools or memory.

## Complete the remaining product capabilities

Existing foundations are reused where they still match the current contracts. These are completion
tracks, not instructions to rebuild everything named here:

- **Memory and preferences:** finish durable remember/correct/forget operations through the memory
  gateway, consent and sensitivity controls, recoverable writes, and cross-conversation recall proof.
  Dataset identity comes from admitted authority, never from a guessed subject ID. See
  [ADR 0015](docs/adr/0015-central-durable-authorization-authority.md) and
  [#318](https://github.com/elewa-git/opencrane/issues/318).
- **Tools and skills:** complete model-loop integration, scoped credentials, approvals, cancellation,
  replay and uncertain-outcome recovery. Reuse immutable OCI MCP execution and the ToolInvocation
  authority. See [#592](https://github.com/elewa-git/opencrane/issues/592),
  [#222](https://github.com/elewa-git/opencrane/issues/222) and
  [#243](https://github.com/elewa-git/opencrane/issues/243).
- **Files and rich results:** complete attachments, scanning, document/multimodal input, generated
  file finalization, A2UI and accessible approval/choice/free-text interaction. Saved results must
  survive refresh, retries and conversation closure. See
  [#602](https://github.com/elewa-git/opencrane/issues/602),
  [#603](https://github.com/elewa-git/opencrane/issues/603) and
  [#604](https://github.com/elewa-git/opencrane/issues/604).
- **Shared scheduled work:** restore supported managed scheduling and trigger execution against
  current identity and lease contracts; prove pause, resume, overlap, retry and cancellation. Removed
  0.10 execution routes are not a compatibility path. See
  [#332](https://github.com/elewa-git/opencrane/issues/332).
- **Company administration:** finish membership, effective access, agent/tool configuration, audit,
  model/provider selection, budget and spending screens over the existing protected APIs. See
  [#224](https://github.com/elewa-git/opencrane/issues/224) and
  [#226](https://github.com/elewa-git/opencrane/issues/226).

## Deliver and qualify efficiently

Use one immutable review base per slice, focused Nx checks while editing, and affected checks at
integration. Independent lanes own separate files; shared contracts land before their consumers.
Specialist dispatch follows the changed responsibility under [AGENTS.md](AGENTS.md). Keep current
permission checks, isolation, immutable evidence and live PR ancestry; avoid repeating green checks
for unchanged source. Commit and push coherent reviewed slices as they land.

The local Stop-hook optimization is a separate tested proposal awaiting explicit approval. Active
hooks remain unchanged until approved. CI boundary checks already run before expensive work.
Dependency and browser caches remain useful; local Nx task-cache transfers between runners were
rejected by Nx and have been removed. Measure subsequent runs before claiming a timing gain.

Qualification of one fresh installation must prove sign-in, onboarding, personal answers, ordinary
groups, assistant work, reconnect, recovery and computer review together. Add tool, memory, shared
work, attachments and administration journeys as those implementations land. Include membership
revocation, cross-silo denial, stale leases, consumer/controller failures, backup/restore, provider
failover, usage/cost and operator recovery. No unresolved Critical/High findings or unproven critical
journeys may be labelled MVP-ready. See [#162](https://github.com/elewa-git/opencrane/issues/162),
[#319](https://github.com/elewa-git/opencrane/issues/319) and
[#351](https://github.com/elewa-git/opencrane/issues/351).
Measure fresh-install readiness against the existing target of ready Pods within five minutes per
silo. Record the result during deployment qualification; it is not a gate on ordinary source edits.

Testv5 has a dedicated Zitadel client, five isolated test employees, a configured model and a
completed personal/group chat fixture. Its pinned Agent Sandbox controller, gVisor, private
networking and non-default CSI storage/snapshot classes are installed. The latest server repair
passed thirteen selected CI/publication jobs and deployed in 228.449 seconds. That is repair
duration, not fresh-install timing or restore RTO. Cold node provisioning previously incurred
liveness restarts; fresh computers on the latest run started without a restart. Review the startup
allowance separately rather than treating the warm-node result as cold-start proof.

The scheduled file-copy `latest` restore recovered all eight audience histories and allowed a new
assistant answer. Scheduled volume snapshots are ready on the provisioned class. An additional
snapshot restore was rejected before execution by automatic approval review; no snapshot recovery
time is claimed.
Cluster changes use the authorized app-owned scripts; exact inputs, incidents and proof belong in
the [deploy ledger](docs/agents/deploy-ledger.md).

## Later work

- [#765](https://github.com/elewa-git/opencrane/issues/765): Git-backed project source, isolated
  builds, immutable published artifacts and PreviewApps after the conversation baseline.
- Warm pooling, extra compute tiers and scale optimization wait for measured latency and cost.
- A generic plugin framework waits for two concrete consumers that need the same extension contract.
- [#513](https://github.com/elewa-git/opencrane/issues/513): evaluate provider-native model tracing
  without prompt/response content export by default.

Version-to-version upgrades return with an explicit MVP upgrade contract. Until then, preserve one
clean baseline and delete superseded code in its owning replacement slice; use git for history.
