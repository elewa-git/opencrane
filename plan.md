# OpenCrane — Active Plan

## Delivery focus — 2026-09-07

OpenCrane gives people and teams assistants that can work with company knowledge and tools,
while the company controls access, data, and spending. MVP means an employee can join, set up an
assistant, get useful work done, and collaborate in a group without understanding the runtime.

The current review surface is [#826](https://github.com/elewa-git/opencrane/pull/826), based on
`develop`. Its 0.11 conversation history and computer baseline is implemented; it is not yet a
live-qualified MVP. [ADR 0016](docs/adr/0016-conversation-history-and-computers.md) supersedes the
older run-owned runtime and relational transcript descriptions in historical plans.

| Work | State and next proof |
| --- | --- |
| Repair #772's obsolete stack ancestry | Done: identical patch rebased as `46ce3204e`, PR targets `develop`, live stack checker passes. |
| Make development checks proportional to the change | Boundary failures run early (`975b80955`), specialist reviews are scoped (`c648801e3`), rejected cross-run Nx cache transfers are removed (`a97c57bcd`), and Helm contracts use isolated chart fixtures (`874181a01`). Fresh-install failures and timing are recorded in the deploy ledger; the repaired 0.11 smoke needs CI qualification. A tested local Stop-hook proposal awaits explicit approval; active hooks are unchanged. |
| Explain the product and architecture consistently | Done in the review branch: README and website use the vision, current ownership, and built/pending status; website build passes. |
| Complete onboarding-to-assistant continuity | Persona forwarding and caller-owned directory done (`825ceb3bc`), with regression tests. Complete live onboarding-to-answer proof remains pending. |
| Make new personal sessions and ordinary group chats usable | All three creation modes distinguish new chats from retries; chat names, enum mapping, inactive-peer reads, reconnect and revocation cleanup are implemented. Multi-person live journey proof remains pending. |
| Ask an assistant to work inside a group | Implementation complete (see [plan-done.md](plan-done.md)): explicit company assistant selection, a fixed shared child audience, durable creation, Back to group and reviewed human-authored sharing. Current CI evidence is recorded on [#826](https://github.com/elewa-git/opencrane/pull/826); live journey proof remains pending. |
| Rebuild channel event reads (#827) | Implemented and qualified against real KurrentDB in CI at `cbdb742d4`: bounded, cancellable participant reads and resumable same-origin SSE on the public listener, consumed by the workspace. The deployed multi-user journey remains to be proven. |
| Qualify backup and restore on testv5 | Blocked at live preflight: testv5 identity configuration is missing, and the dev cluster has no testv5 namespace or VolumeSnapshotClass. Record installation prerequisites and real recovery timing in the deploy ledger. |

Completed implementation moves to `plan-done.md`; live evidence belongs in
[`docs/agents/deploy-ledger.md`](docs/agents/deploy-ledger.md). A green test, a pushed change, a
deployed image, and a proven user journey are separate facts.

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
- Authorized participants can inspect files, diffs, allowlisted commands, screenshots and temporary
  local previews. Published applications, interactive desktops and unrestricted terminals are absent.
- Backup schedules, restore tooling, HTTPS probes and disruption protection are implemented; their
  live recovery drill is still pending.

The baseline uses fresh installation only. There is no migration, dual-write mode, compatibility
route, or second Pod controller. [ADR 0016](docs/adr/0016-conversation-history-and-computers.md)
supersedes older runtime, storage and upgrade descriptions. Source completion, CI, deployment and
live product acceptance remain separate evidence.

## Finish the first useful journeys

| Journey | Remaining work | Acceptance |
| --- | --- | --- |
| Join and use a personal assistant | Qualify invite/sign-in, saved onboarding, approved settings, assistant selection and first answer together. | Two employees independently complete setup and receive answers influenced by their own approved settings. Refresh and retry preserve progress. |
| Start and revisit chats | Qualify independent sessions, readable labels, reconnect and visible recovery together. | A new request creates a new chat; retry creates none extra; closed chats remain closed; late responses cannot replace the selected chat. |
| Talk as a group | Qualify group navigation, ordered delivery, creation retries and membership changes with real accounts. | Three employees exchange ordered messages and resume after reconnect; ordinary messages create no agent run. |
| Ask an assistant in a group | Qualify the implemented operator setup API, company assistant selection, durable child recovery, Back to group and reviewed sharing together. Record integration CI on the single review PR. | One request creates one child with its admitted audience; a late join does not change retries; answers use the company's model authority; reviewed results post as the human; revocation and guessed IDs reveal no private content. |
| Receive live conversation updates | Qualify the implemented [#827](https://github.com/elewa-git/opencrane/issues/827) stream against live KurrentDB; measure the remaining initial-history and periodic computer replay cost. | Disconnect cancels upstream work; a reconnect resumes by stream revision; access is rechecked before plaintext delivery. |
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

Live testv5 work currently needs an installation configuration and namespace-local credentials.
The repeated preflight found no saved or live testv5 identity configuration. The remaining operator
inputs are the OIDC issuer, client ID, secure client-secret reference, first-owner email and ACME
contact email. PostgreSQL and KurrentDB credentials must be generated for the new namespace through
the app-owned deployment flow; credentials from another silo are not testv5 installation inputs.
The dev cluster has a ready pinned Agent Sandbox controller and gVisor, but no testv5 namespace or
VolumeSnapshotClass. The required drill is one scheduled fileCopy backup, a full `latest` restore
with measured RTO, an anonymous `/health/live` check on KurrentDB 26.1.1 with anonymous endpoint
access disabled, and snapshot-mode qualification when a supported class exists. Cluster changes
use the authorized app-owned scripts. Record actual results in the
[deploy ledger](docs/agents/deploy-ledger.md), not as assumed completion here.

## Later work

- [#765](https://github.com/elewa-git/opencrane/issues/765): Git-backed project source, isolated
  builds, immutable published artifacts and PreviewApps after the conversation baseline.
- Warm pooling, extra compute tiers and scale optimization wait for measured latency and cost.
- A generic plugin framework waits for two concrete consumers that need the same extension contract.
- [#513](https://github.com/elewa-git/opencrane/issues/513): evaluate provider-native model tracing
  without prompt/response content export by default.

Version-to-version upgrades return with an explicit MVP upgrade contract. Until then, preserve one
clean baseline and delete superseded code in its owning replacement slice; use git for history.
