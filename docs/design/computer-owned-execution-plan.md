# Computer-owned execution and platform constraints

## Decision and status — 30 September 2026

The computer is an assistant with a managed laptop, not a workspace attached to a server-owned
agent. The harness owns execution; OpenCrane constrains authority and supervises lifecycle.
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
| Harness inside the computer | Working context, model/tool loop, compaction, code, subprocesses, files, browser and resumable session | Another copy of a server-owned agent loop |
| OpenCrane platform | Identity, current permissions, payer, approvals, schedules, computer provisioning, Stop and revocation | A service that authorizes every thought, local calculation or workspace edit |
| Trusted execution registration | Execution ID, admitted identity, parentage, payer binding, current authority, location and coarse status | A duplicate harness checkpoint or task wallet |
| Protected service owners | Model access/spend, MCP effects, memory, artifact publication and their own receipts | Credentials or policy enforced only by the model following instructions |
| KurrentDB and existing authorized event adapters | Durable task commands, decisions, safe progress/results and frontend reconnect | A second executable reasoning state machine or direct public broker access |

Live session state belongs inside the computer; durable checkpoint storage may remain outside its
disposable Pod. The platform authorizes the lease; the computer cannot mint its own authority.
Approvals, charges and external-effect receipts keep their existing service owners and correlate
to an execution ID. Do not move PostgreSQL credentials or the entire AgentRun schema into the Pod.

Reuse `apps/conversation-computer`, Agent Sandbox, the private OpenCrane listener and projected
workload identity. Keep app code bootstrap-only and adapters under the existing functional library
owners. No new deployable, broker, scheduler or generic multi-harness framework is required by this
plan. Current deployment documentation describes existing wiring, not proof of this target.

## Delivery sequence

1. **Compatibility proof first.** Time-box the initial investigation to 1–2 engineering-days.
   Evaluate a pinned Codex runtime as the first candidate, not an already-selected dependency.
   Check license/distribution, startup in the current Python/Alpine image, configured inexpensive
   models, Responses routing versus the existing Chat Completions route, retry behavior, approval
   mapping, subprocess interruption, session persistence and configurable delegation limits.
   A built-in child/depth/concurrency ceiling must not silently reinstate the rejected product caps.
   Use fake services first; document a pass or concrete incompatibility before committing to the
   adapter. If unsuitable, select one evidenced alternative rather than build a framework.
2. **One computer-owned vertical journey.** A platform-admitted task reaches the computer through
   the existing authenticated event boundary. The harness calls a protected model gate, performs
   local work, and reports progress/result. Prove restart without blind redispatch and Stop before
   the next protected call. Gate decisions return useful typed refusals to the harness. Establish
   the event producer, correlation, ordering, duplicate delivery and outage/buffering contract;
   frontend activity contains useful summaries, never secrets or private reasoning.
3. **Reconnect constraints and useful work.** Adapt existing remote/hosted MCP, memory gateway,
   approval/elicitation, artifact and schedule owners. Implement reported-spend cutoff and private
   group-of-one admission. Do not route every local action through central effect approval.
   Protected calls recheck current permission and revocation at use; shell/browser egress must not
   provide a credential-bearing bypass of the same boundaries.
4. **Delegation and parent Stop.** The harness decides when to spawn or join; OpenCrane registers
   lineage and checks authority. Children inherit the selected payer and narrower explicit context
   and capabilities. No fixed nesting, spawn or active-child cap. Close protected access and new
   spawning for the stopped subtree, persist the Stop command, signal the computer, then force
   cleanup after a bounded grace period. Prove spawn/Stop races, branch isolation, restart and
   descendants that outlive a failed parent. Signal delivery alone is not confirmed Stop.
5. **The same computer is visible.** Add an authorized view of the persistent browser the agent
   actually controls, plus activity, files and published deliverables. Current screenshots start
   a separate Chromium process; replace that behavior. Restore the profile before browser startup,
   capture coherent checkpoints, and supervise browser/harness health. Raw CDP stays private.
   Interactive user takeover is a follow-on unless separately selected for MVP; it must pause
   agent input and use a single controller. The harness SDK alone does not supply this viewer.
6. **Direct cutover and qualification.** Delete the replaced server loop and its obsolete tests,
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
  the recommendation to validate in the harness slice, not a claimed implemented change. Keep
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

Replace server-owned model/tool progression with the selected harness adapter. Remove task-tree
financial transfers and reservation policy without deleting lineage, replay identity or incurred
usage evidence. AgentRun simplification follows its actual consumers, not blanket schema deletion.

Hold the uncommitted descendant-Stop integration unchanged: it is tied to the old Absurd turn and
server-issued model credentials. Port its tested cancellation, race and cleanup invariants to the
new boundary before committing its replacement. Its unresolved database constraint and unexecuted
SQL regression remain recorded in the active plan; this document does not resolve them.

## Impact and effort estimate

These are low-confidence planning ranges for an experienced engineer, including focused tests and
review. They are work-days, not autonomous-agent runtime, calendar dates or measured throughput.
Re-estimate after the compatibility proof. Browser recovery and existing integration gaps are the
largest downside risks. Source counts describe current scope, not promised deletions or net growth.

| Change | Measured existing source and likely change | Architectural effect | Engineering-days |
| --- | --- | --- | --- |
| Embed the harness and retire custom progression | 5,989 server-turn LOC to classify; 862 directly in model-flow/workflow replacement candidates; add a thin computer adapter | Much less first-party agent-loop logic; introduces a pinned upstream dependency | 4–7, including 1–2 for compatibility |
| Constraint gates, event adapter and minimal execution registration | 3,028 LOC in current model-boundary core/proxy; adapt existing registration/event owners rather than duplicate them | One executor; platform keeps authority, not step orchestration | 2–4 |
| Reported-spend group budgets | 980 ledger LOC to simplify, plus financial portions of the 518-line tree owner | Removes reservation/transfer state machines and personal bypass | 2–3 |
| Recursive delegation and Stop | Preserve/rework that 518-line lineage owner and existing Stop; add harness spawn/join integration | Necessary distributed lifecycle remains; no task wallets or business spawn caps | 3–5 |
| Shared browser, local files and artifact publication | 628 computer bootstrap/review LOC plus 359 frontend review LOC are foundations, not a complete viewer | Adds a real capability and session supervision; reuse existing access/storage owners | 2–4 |
| Reconnect tools, memory and routines | Preserve most of 6,892 routine/admission LOC; adapt MCP/memory/elicitation boundaries as needed | Reuses product capabilities through one execution path | 2–4 |
| Joined tests, fresh-install proof and deletion audit | Port surviving invariants from 7,064 turn-test LOC; add cross-boundary acceptance tests | Proves the replacement and prevents a retained second runtime | 3–5 |

Total forecast: **18–32 engineering-days for this transition and its connected qualification**.
Parallel lanes may shorten elapsed time but do not remove integration and review work. This is not
an exhaustive remaining-MVP estimate: any still-missing memory, hosted-MCP, onboarding, administrator
or recovery capability must also close its existing acceptance criteria. No MVP date is promised.

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
harness and a consumer-based deletion inventory. Total repository size may grow as features/tests
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
- Scheduled and manually fired work using the same harness, explicit audience, overlap handling,
  recovery, elicitation notification and current permissions.
- Memory remember/recall/correct/forget, remote and hosted MCP, files/scanning, administration,
  sign-in/reconnect and uncertain-write recovery retain their existing MVP acceptance requirements.

Use fake providers first. Any paid qualification stays within the original **€5 total across all
tests and retries**, using inexpensive models and securely configured credentials. Reconcile prior
usage before starting; this plan does not claim a newly available €5 balance. Retire only verified
superseded test deployments through the existing authorized app-owned workflow.

Sources for candidate evaluation: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) and
[app-server](https://learn.chatgpt.com/docs/app-server). API availability is not OpenCrane integration
proof. The SDK is not the Codex desktop application's plugin/browser surface; qualify the pinned
interface and transport before treating them as production-ready.

See also: [MVP acceptance](mvp-delivery-plan.md), [active plan](../../plan.md),
[architecture guidance](../agents/architecture.md), [release policy](../agents/versioning.md).
