# Computer-owned execution and platform constraints

## Decision and status — 30 September 2026

The computer is an assistant with a managed laptop, not a workspace attached to a server-owned
agent. The selected implementation direction is to extract and adapt OpenCrane's existing
TypeScript execution engine into the existing conversation-computer Pod. That in-computer engine
owns execution; OpenCrane constrains authority and supervises lifecycle. Codex and OpenHands remain
useful research references, but adopting either is not a prerequisite or the selected path.
This plan records the latest user direction and supersedes conflicting executor and financial
ownership clauses in the older MVP plan and ADR 0016. Their product outcomes remain required.
This is a planning change, not implemented runtime behavior or live MVP qualification.

Evidence is the implementation worktree at `1a40f0166dadf5b7ef19ebfa1c5675d33477e36d`
with the uncommitted descendant-Stop overlay inspected separately.
Existing green tests qualify their original source only. No provider calls or live changes were
made to prepare this plan.

## Ownership

| Owner | Responsibility | Must not become |
| --- | --- | --- |
| TypeScript execution engine inside the computer | Working context, model/tool loop, compaction, code, subprocesses, files, browser and resumable session | Another copy of a server-owned agent loop |
| OpenCrane platform | Identity, current permissions, payer, approvals, schedules, computer provisioning, Stop and revocation | A service that authorizes every thought, local calculation or workspace edit |
| Trusted execution registration | Execution ID, admitted identity, parentage, payer binding, current authority, location and coarse status | A duplicate harness checkpoint or task wallet |
| Protected service owners | Model access/spend, MCP effects, memory, artifact publication and their own receipts | Credentials or policy enforced only by the model following instructions |
| KurrentDB and existing authorized event adapters | Durable task commands, decisions, safe progress/results and frontend reconnect | A second executable reasoning state machine or direct public broker access |

Live session state belongs inside the computer; durable checkpoint storage may remain outside its
disposable Pod. The platform authorizes the lease; the computer cannot mint its own authority.
Approvals, charges and external-effect receipts keep their existing service owners and correlate
to an execution ID. Do not move PostgreSQL credentials or the entire AgentRun schema into the Pod.

Reuse `apps/conversation-computer`, Agent Sandbox, the private OpenCrane listener and projected
workload identity. Keep app code bootstrap-only and move reusable engine behavior into the existing
functional library owners. No new deployable, broker, scheduler, generic multi-harness framework or
second executor is required by this plan. Current deployment documentation describes existing
wiring, not proof of this target.

## Delivery sequence

1. **Dependency and replacement preflight.** Trace the existing TypeScript loop's production
   callers, tests, provider boundary, Kurrent state and Absurd workflow coupling. Classify each part
   as move, rewrite, survive outside the Pod or delete after replacement. Freeze the smallest
   computer-owned contracts and prove the current image can start the extracted engine. Do not copy
   Prisma access or Absurd's agent-step state machine into the Pod, and do not build a compatibility
   bridge to keep both loops active.
2. **One computer-owned real task.** A platform-admitted task reaches the computer through the
   existing authenticated boundary. The engine requests a model response, writes and runs local
   code or a local tool, feeds the observed result back to the model, produces a useful report and
   publishes safe progress/result. Prove checkpoint recovery and Stop before the next protected
   call. Gate decisions return useful typed refusals. Establish event correlation, ordering,
   duplicate delivery and outage/buffering; frontend activity contains useful summaries, never
   secrets or private reasoning. Fake services prove mechanics but do not qualify the real journey.
3. **Reconnect constraints and useful work.** Adapt existing remote/hosted MCP, memory gateway,
   approval/elicitation, artifact and schedule owners. Implement reported-spend cutoff and private
   group-of-one admission. Do not route every local action through central effect approval.
   Protected calls recheck current permission and revocation at use; shell/browser egress must not
   provide a credential-bearing bypass of the same boundaries.
4. **Delegation and parent Stop.** The in-computer engine decides when to spawn or join; OpenCrane registers
   lineage and checks authority. Children inherit the selected payer and narrower explicit context
   and capabilities. No fixed nesting, spawn or active-child cap. Close protected access and new
   spawning for the stopped subtree, persist the Stop command, signal the computer, then force
   cleanup after a bounded grace period. Prove spawn/Stop races, branch isolation, restart and
   descendants that outlive a failed parent. Signal delivery alone is not confirmed Stop.
5. **The same computer is visible.** Add an authorized view of the persistent browser the agent
   actually controls, plus activity, files and published deliverables. Current screenshots start
   a separate Chromium process; replace that behavior. Restore the profile before browser startup,
   capture coherent checkpoints, and supervise browser/engine health. Raw CDP stays private.
   Interactive user takeover is a follow-on unless separately selected for MVP; it must pause
   agent input and use a single controller. The execution engine does not itself supply this viewer.
6. **Direct cutover and full MVP qualification.** Delete the replaced server loop and its obsolete tests,
   configuration and financial tree fields after their required capabilities have surviving owners.
   Do not keep two active agent loops or build a compatibility bridge. Rebuild the clean baseline
   where schema changes require it. Run the joined acceptance journeys below on one exact candidate.

Steps 3–5 can use independent Luna/Sol lanes after step 2 fixes the shared contracts. Review each
coherent slice proportionally; keep one incremental PR surface per change and commit reviewed work.

## Financial and interaction decisions carried forward

- Select one real paying group at admission. Personal work uses a private group of one; children
  inherit that payer. Billing unification grants no extra group membership or data access.
- EUR monthly reported spending is checked against applicable global, group and optional assistant
  ceilings. No advance cost estimates, per-request monetary reservations or run/child wallets.
  Crossing a limit closes further paid dispatch and stops affected active work; previously admitted
  work gets no finishing exemption. In-flight and delayed charges can overshoot the threshold.
  Retain late and uncertain charges, physical-request identity and safe retry/reconciliation evidence;
  unknown usage is not zero and a failed budget check cannot become unmetered dispatch.
- Remove the fixed model-call termination cap. Removing the aggregate completion-token cap remains
  the recommendation to validate in the engine slice, not a claimed implemented change. Keep
  per-request output limits, transport timeouts and scoped lease/credential renewal. Reassess overall
  job deadlines separately; do not silently erase them or add a hidden replacement call cap.
- Keep per-connection, per-tool Allow automatically / Ask / Block. Explicit automatic approval also
  covers the first permitted write; permission and revocation checks still apply. Preserve the
  requester-only action approval/cancellation policy. Shared elicitation may be answered by any
  current participant of its explicitly shared subchat, without granting action-approval authority.
- Code may create local reports and files directly. Publishing/sharing them uses the existing artifact
  owner and required scan/grant lifecycle. Memory reads and writes keep the gateway, dataset,
  consent and provenance boundaries. No direct Cognee or provider master credentials in the computer.
- Preserve routine creation from a preconfigured agent-elicited form with notification, explicit
  sharing, manual firing, automatic overlap skipping and latest missed-run recovery under current
  permissions. Scheduling launches the same computer path, not a second reasoning executor.

## Preserve, replace and hold

Preserve current permissions, focused capability contracts, MCP connection custody, approval/effect
receipts, artifact and memory owners, routine definitions, conversation history and SSE. Preserve
the Cancelled-to-next-admission correction and the invariants demonstrated by existing tests.

Replace server-owned model/tool progression with the extracted in-computer TypeScript engine. The
current 412-line model flow and 450-line workflow are classification inputs, not a promise to delete
all 862 lines: provider gates, receipts and lifecycle behavior survive in their proper owners.
Remove task-tree
financial transfers and reservation policy without deleting lineage, replay identity or incurred
usage evidence. AgentRun simplification follows its actual consumers, not blanket schema deletion.

Hold the uncommitted descendant-Stop integration unchanged: it is tied to the old Absurd turn and
server-issued model credentials. Port its tested cancellation, race and cleanup invariants to the
new boundary before committing its replacement. Its unresolved database constraint and unexecuted
SQL regression remain recorded in the active plan; this document does not resolve them.

## Measured change surface

The earlier 18–32 engineering-day forecast assumed evaluation and adoption of an external harness.
It is superseded and must not be used for this extraction path. Re-estimate only after the dependency
and replacement preflight exposes the actual coupling. Source counts describe current scope, not
promised deletions, net growth or an MVP date.

| Change | Measured existing source | Architectural effect | Effort status |
| --- | --- | --- | --- |
| Extract computer-owned progression | 5,989 server-turn LOC to classify; 862 in the model-flow/workflow candidates | One loop moves into the existing Pod; service gates remain outside | Measure after preflight |
| Constraint gates, events and registration | 3,028 LOC in current model-boundary core/proxy | Platform retains authority without selecting each agent step | Measure after contracts freeze |
| Reported-spend group budgets | 980 ledger LOC plus relevant portions of the 518-line tree owner | Replace reservation transfers with reported cutoff while retaining payer and evidence | Measure after consumer map |
| Recursive delegation and Stop | 518-line lineage owner plus the preserved Stop overlay | Retain durable distributed lifecycle without wallets or fixed product caps | Measure after rewire design |
| Shared browser, files and artifact publication | 628 computer bootstrap/review LOC plus 359 frontend review LOC | Extend the existing computer instead of adding another executor | Measure after same-session spike |
| Reconnect tools, memory and routines | 6,892 routine/admission LOC are mostly survivors | Reuse protected services through the computer-owned loop | Measure per capability slice |
| Joined qualification and deletion audit | 7,064 current turn-test LOC contain invariants to classify | Prove direct replacement before deleting obsolete tests and state | Measure after survivor map |

Counting method: physical authored source lines, including comments/blanks, excluding tests,
fixtures/configuration, generated/vendor/build output. Test counts are separate. Selected scopes:
`libs/backend/server/conversations/main/src/computers/turns`,
`libs/backend/agents/execution/runs/main/src/monthly-budget`,
`libs/backend/agents/execution/runs/main/src/tree`,
`libs/backend/server/gateways/model-routing/main/src/core` and its sibling `proxy`,
`libs/backend/server/conversations/main/src/routines`, and
`libs/backend/server/agents/scheduling/main/src`.
Computer count is `apps/conversation-computer/src/main.py` (150) plus review-surface Python (478).
Frontend count is the four computer-review component files (208) plus its store (151).
Some impact rows share owners; do not sum LOC. Exact net additions/deletions require the selected
engine and a consumer-based deletion inventory. Total repository size may grow as features/tests
are added even while first-party orchestration complexity falls.

## Completion evidence

Do not mark the transition or MVP complete from source tests, screenshots or healthy Pods alone.
Require focused unit/contract checks, real SQL races and Kurrent replay, then fresh-install and
authenticated browser evidence on one immutable source/image candidate:

- Multi-step Odoo inventory analysis through the default authorized MCP, local total calculation,
  a downloadable report, and one precisely approved write with its observed result.
- Same-session browser observation and restored workspace/session, with access revoked for a former
  participant. A screenshot of a separately loaded page is not proof.
- Recursive parallel children beyond the rejected 2/4/2 defaults; parent/branch Stop, payer
  inheritance, late usage and budget-cutoff races, with unrelated branches isolated.
- Scheduled and manually fired work using the same engine, explicit audience, overlap handling,
  recovery, elicitation notification and current permissions.
- Memory remember/recall/correct/forget, remote and hosted MCP, files/scanning, administration,
  sign-in/reconnect and uncertain-write recovery retain their existing MVP acceptance requirements.

Use fake providers first. Any paid qualification stays within the original **€5 total across all
tests and retries**, using inexpensive models and securely configured credentials. Reconcile prior
usage before starting; this plan does not claim a newly available €5 balance. Retire only verified
superseded test deployments through the existing authorized app-owned workflow.

## First implementation handoff

Start the new implementation task from the committed checkpoint created for this planning change;
exclude the preserved, uncommitted descendant-Stop overlay from that task's base. The first slice is
limited to dependency/replacement preflight and the single computer-owned real task above.

Source anchors are
`libs/backend/server/conversations/main/src/computers/turns/conversation-computer-model-flow.ts`,
`libs/backend/server/conversations/main/src/computers/turns/workflow/conversation-computer-turn-workflow.ts`,
`apps/conversation-computer/src/main.py`, and the existing conversation-computer review-surface
library. The slice may move or extract cohesive TypeScript owners and adapt the existing Pod
composition; it must not create another deployable executor, copy database authority into the Pod,
or modify unrelated Stop/budget policy.

Acceptance is one exact admitted task that completes model → local code/tool → observed result →
model → report inside its computer, emits safe progress, restores from a checkpoint without
repeating protected work, and obeys Stop before another protected call. Focused fake-provider tests
are required evidence but are not paid-provider, fresh-install or live-product qualification.

See also: [MVP acceptance](mvp-delivery-plan.md), [active plan](../../plan.md),
[architecture guidance](../agents/architecture.md), [release policy](../agents/versioning.md).
