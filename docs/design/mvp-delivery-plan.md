# Deliver useful assistant work

OpenCrane gives employees and teams assistants that can use company knowledge and tools under
company control. The conversation baseline proves that people can join, approve personal settings,
receive answers, collaborate in a group and review a company assistant's response. The next product
step is to complete useful work and make returning to that work dependable.

This plan covers all remaining gaps identified on 2026-09-08. The user authorized planning and
overnight execution, with intermittent commits and reviewable PRs. It does not claim that the
whole MVP can be delivered in one night. `plan.md` owns current status, `plan-done.md` owns completed
tracks, and the deployment ledger owns live evidence.

## Release outcomes

| Milestone | Outcome | Required evidence |
| --- | --- | --- |
| Finish the 0.11 review baseline | People can onboard and use durable personal and group text chats. | Repair the remaining replay-contract CI failure; retain the existing live journey and recovery evidence. Review remains on #826. |
| First follow-up PR | People can return to their assistant without losing login or completed activity. | Server replacement preserves a valid login, completed personal runs appear for their owner, and other people cannot read them. |
| 0.12.0 | An assistant retrieves permitted company data and completes a human-approved action. | One real integration works through personal and company-child chats; activity, approval, cancellation, retry, result and current access remain correct after interruption. |
| Remaining MVP tracks | People can use memory, files, delegation, scheduled work and understandable administration. | Each track below has its own complete user journey and negative/recovery proof. Assign later version numbers when its release scope is selected. |

0.12 uses the current conversation/computer ownership. PostgreSQL remains the authorization
authority, KurrentDB stores history, and Agent Sandbox owns Pods. Reuse the memory gateway and
durable tool invocation/executor owners. Pre-MVP installations use a clean baseline; schema changes
regenerate and verify that baseline. A release number does not add an upgrade or migration layer.

## Small PRs and their acceptance

Each row is a bounded implementation slice. Split a row further when its review would combine
independent ownership or unrelated risks. A dependency means a required contract, shared file or
actual authority prerequisite; it is not a reason to serialize independent implementation.

| ID | User outcome and implementation boundary | Depends on | Acceptance |
| --- | --- | --- | --- |
| C0 | Stable replay-contract CI. Own the replay test clock, preserve production deadlines. | Existing #826 | Deterministic timeout/sleep assertions; current `deploy-k8s:test` passes on Linux CI. |
| R1 | Login survives server replacement. Extend the existing session owner and storage; remove the process-local store as an authority. | C0 for branch handoff | A fresh sign-in remains valid after a server replacement and across two server instances; logout, expiry and membership loss still deny access. Stored session secrets are protected and expiry cleanup is bounded. |
| R2 | Completed personal work is visible. Create the verified personal owner’s exact run-read grant during admission; preserve current read authorization. | Current run contracts; coordinate any shared R1 files | A completed run appears to its owner with correct conversation/status links; another employee and another silo cannot discover it. Do not grant broader rights merely to make a list nonempty. |
| A1 | Administrators can remove access and people cannot reopen revoked work. Extend existing membership/participant operations and their current UI owner. | R1 for live session continuity; current authority contract | A real member is removed through the product, subsequent reads/actions fail, selected private history/drafts clear, reconnect and late responses cannot restore them, and closed work stays closed. |
| T1 | An assistant retrieves one permitted record and explains it. Connect compiled tool definitions to the conversation runtime, a run/lease-bound tool proposal/result contract and the existing MCP invocation owner. | C0; define shared contract before consumers | One installed read-only integration returns real data in both personal and company-child chats. Current grants, frozen tool revisions, credentials and budgets are checked. Retry/restart preserves invocation identity; tool activity/result and the final answer survive reload. |
| T2 | People approve a precise external change. Connect the existing approval and effect-admission owners to T1 and the conversation UI. | T1; A1 before live revocation acceptance | The person reviews the exact target and arguments. Approval is bound to that action, denial executes nothing, changed arguments need a new decision, and a company assistant does not inherit private human credentials. |
| T3 | Interrupted actions remain understandable. Complete cancellation, durable completion and uncertain-outcome handling in the same invocation owner. | T1 and T2 | Cancellation fences future effects; stale leases cannot execute; retry does not duplicate a write. A provider timeout after submission is shown as uncertain until reconciled, never as fabricated success or an automatic unsafe retry. |
| U1 | People can follow and control assistant work. Extend the existing workspace event mapping and approved UI components. | T1 contract; T2/T3 states before final proof | Show proposed/running/waiting/failed/cancelled/completed work, approval details and result links. Reload and SSE resume preserve the state. Accessible approval, choice and free-text interactions use server-issued contracts. |
| M1 | An employee explicitly remembers, corrects and forgets information. Complete dataset provisioning and the existing memory gateway/catalog path. | Current identity contracts; T1 only if memory uses the tool proposal path | Remember a fact, recall it in another conversation, correct it, then forget it. Dataset selection comes from admitted authority; provenance, consent and sensitivity are visible. Another employee, silo or unentitled group cannot recall it. New runs capture the authorized dataset; immutable old snapshots are not patched. |
| F1 | People attach documents and receive durable files. Complete existing artifact upload, scan, model-input and output-finalization owners. | Current artifact contracts; T1 when generation uses tools | Upload an allowed document, answer using its contents, create a downloadable result, then reload/retry/close the conversation. Infected or unscanned content stays unavailable; unauthorized readers and stale workers cannot retrieve or finalize it. |
| D1 | An assistant delegates a bounded task and receives the result. Compose existing child admission, reservation and completion ownership with a model-visible spawn operation. | T1 and T3; F1 or M1 only when delegated context includes those resources | One child uses explicitly selected authorized context, narrower capabilities and bounded depth/fan-out/spend. Its terminal result returns once; parent cancellation propagates. Siblings cannot read each other and child failures remain visible. Prove one level before recursive cases. |
| S1 | Teams schedule useful work. Restore scheduling/trigger execution against the current identity, admission and lease contracts. | T3; D1 only for workflows that delegate | One scheduled company task runs with current authority. Pause/resume, overlap policy, retry, cancellation and missed triggers have explicit outcomes. Removing its permission prevents the next effect. Retired runtime routes remain deleted. |
| A2 | Administrators configure assistants, integrations and spending in the product. Extend existing protected APIs and settings owners. | Relevant capability contracts from T1/T2/M1/S1 | A company operator configures one agent, provider/model, tool grant and budget, reviews effective access and usage, and revokes the grant. Ordinary employees cannot perform those changes or view secrets. Figures are actual recorded usage, with unknown cost stated explicitly. |
| Q1 | The complete product recovers predictably under normal failures. Maintain focused operational proofs throughout delivery. | Run as each capability lands; final acceptance after selected tracks | Prove fresh-install readiness, cold computer startup, controller/consumer failure, provider failure, long-history cost, access changes, backup recovery and usage accounting on exact qualified images. Separate measured recovery intervals from user-visible outage and repair-deploy timings. |

For T1, begin with one already installed, authorized read-only integration. If none is suitable,
record the missing test integration and prepare the internal contract and deterministic tests;
do not install a marketplace or invent credentials. T2's live effect must use a dedicated test
record/system with existing authorization. Real customer messages or writes require their own
explicit authorization. The runtime proposes work; it never becomes the authority that approves it.

The MCP public task API is caller-owned and does not supply the conversation run binding. Do not
impersonate a human through that API to avoid adding the required run/lease-bound admission. The
current lifecycle reporter validates fences but does not persist participant history; T1 must
connect real tool activity/results to KurrentDB rather than treating log output as conversation proof.

Long-term memory and autonomous delegation are not prerequisites for the first useful tool action.
The existing #320 issue is closed but retains unfinished and obsolete runtime wording; refresh or
replace its delivery issue before D1, using ADR 0016 as the current architecture. A closed issue or
an old implementation narrative is not evidence of live functionality.

## Owners and parallel waves

| Lane | Ownership | First useful assignment |
| --- | --- | --- |
| Reliability | Existing authentication/session and personal activity packages; corresponding schema only if required | R1 and R2, with independent discovery and one coordinator for shared contracts |
| Actions | Conversation-computer runtime, conversation turn transport, MCP invocation boundary and their contracts | T1 preflight, then one retrieval journey |
| Workspace | Existing Angular workspace/settings stores, mappers and approved components | U1 contract mapping; A1 product operation after authority preflight |
| Memory | Memory gateway client, personal memory catalog and shared memory contracts | M1 source-grounded preflight; no direct Cognee calls outside the gateway |
| Operations and review | Owning deploy/test scripts, CI evidence, scoped independent review | C0, then Q1 for each landed capability |
| Documentation | Package READMEs, website guides/status, plan and changelog | Explain the user outcome and mark code, CI and live evidence separately in each slice |

Start C0 and the plan together. After C0 lands, create the R1/R2 follow-up review surface. T1
contract discovery can run alongside reliability work; its runtime, server and UI consumers start
only after the shared contract is settled. M1, F1 and A2 discovery can proceed independently once
there is worker capacity. D1 and S1 wait for their actual action/cancellation dependencies.

Every implementation worker receives explicit file ownership and the current immutable base. One
coordinator owns branch changes, commits and shared planning files. Workers never revert another
lane. Reuse completed agents when capacity is exhausted; if no independent reviewer is available,
leave the review pending and continue safe independent work rather than declaring self-review done.

## Overnight execution: 8–9 September 2026

Work begins on 8 September in Nairobi and checkpoints at **08:00 EAT on 9 September**
(`2026-09-09T05:00:00Z`). Continuation checks every fifteen minutes use the current task and this
plan. They recover work between working turns; active runs continue directly between ready slices.

1. Repair C0 on #826; record focused validation, independent review and the exact CI run. Keep
   previously qualified application evidence attached to its source; a test-only fix does not
   require repeating the live backup drills.
2. Create the immediate follow-up branch from the reviewed parent and record its immutable base.
   While #826 is open, target its branch; if it has merged, use `develop` and prove the ancestry.
3. Execute R1/R2 and the ready T1 work in bounded slices, using independent lanes where their files
   do not overlap. Continue through the ordered backlog as dependencies and available time allow.
4. At each gate, run focused Nx checks, required boundaries and risk-scoped independent review.
   Push each coherent reviewed slice. Keep its PR incremental and explain the review order.
5. For a real blocker, record the exact evidence and dependency, then continue another ready lane.
   Do not spend the night repeatedly checking an unchanged queue or redoing a green proof.
6. Before the morning boundary, finish or checkpoint the active slice. At or after 08:00 EAT,
   begin no new implementation slice: record commits, PRs, CI, live proof, unresolved findings and
   the next exact action, report here, and pause the overnight schedule. A late wake produces the
   handoff instead of silently extending the run.

The desired morning result is a repaired baseline, a reviewable continuity follow-up and concrete
progress toward the first governed action, with every other MVP track planned. Progress depends
on review, CI and external test availability; none of these targets are a promise that all MVP
features will be complete by morning.

## Delivery boundaries and evidence

- Commits, pushes and PRs are authorized by this task. Merging and release tags remain separate
  actions. Keep root version 0.11.0 until the 0.12 release baseline is intentionally opened; update
  version and manifest together then, not once per change.
- Read current `AGENTS.md`, the selected row and its owning contracts. Apply architecture review
  to changed trust/responsibility boundaries, deletion review to replaced mechanisms, and one
  integrated independent review to each required slice. Preserve the current local Stop hooks.
- Run tasks with `npx nx`. Use one relevant local test/build cycle per unchanged slice; reserve
  container-backed authority, image and cluster proofs for Actions. Never start a local VM or
  container runtime for validation.
- Use existing dedicated testv5 Zitadel/provider credentials only through their intended services.
  Keep credentials, test passwords and private payloads outside Git and logs. Preserve ignored
  `keys/` fixtures and unrelated untracked `.codex`, `.agents` and screenshots.
- Cluster mutations use app-owned scripts only. No raw Kubernetes/Helm/SQL writes, serving-volume
  replacement, silo teardown or repeat of the rejected additional snapshot restore is included in
  the overnight run. Prepare a reviewable plan for any newly necessary destructive operation.
- Avoid new infrastructure, generic plugin frameworks and broad abstractions until a concrete
  user journey needs them. Reuse and extend the current owners; delete superseded paths.
- On each push/PR change and hourly checkpoint, refresh exact live ancestry. Capture committed,
  staged, unstaged and untracked overlays separately. CI results name their SHA and run URL;
  deployment results name immutable images; live acceptance names the tested journey and fixture.
- Keep routine scheduled runs quiet. Notify on a material delivery, failure requiring attention,
  blocked decision or the morning handoff. Do not send messages to external people.

## Later product expansion

Mini-app previews/publication and internal CodeService follow the useful-assistant MVP tracks.
Internal Git, broad marketplaces, additional compute tiers and warm-pool optimization are not
overnight prerequisites. Select those scopes from measured user demand and latency/cost evidence.

See also: [Active plan](../../plan.md), [product contract](personal-agent-platform-product-contract.md),
[workspace stories](../user-stories/workspace-and-conversations.md),
[conversation architecture](../adr/0016-conversation-history-and-computers.md),
[release policy](../agents/versioning.md), and [deployment evidence](../agents/deploy-ledger.md).
