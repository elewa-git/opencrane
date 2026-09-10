# Deliver useful assistant work

OpenCrane gives employees and teams assistants that use company knowledge and tools under company
control. Personal and group text journeys already have implementation and live evidence. The next
step is useful work with real records, explicit decisions, durable results and understandable controls.

This plan records the user's priority order accepted on 10 September 2026. It supersedes the earlier
overnight sequencing. `plan.md` owns current execution status, `plan-done.md` records completed tracks,
and the deployment ledger records live evidence. A track may require several incremental PRs; the
whole MVP is not one implementation or qualification claim.

## Priority order and acceptance

Dependencies below are concrete contracts. A small prerequisite lands with the feature that needs it:
tool configuration is part of retrieval, and the exact approval presenter is part of approved actions.
Complete administration, rich interaction and action recovery keep their later positions.

| Priority / ID | User outcome and owner | Required contract | Completion evidence |
| --- | --- | --- | --- |
| 1 / T1 | Retrieve real company information and explain it. Agent services own assignment; input assembly freezes definitions; conversation turns and MCP own invocation/results. | Current company or personal identity, exact tool revision, authorized connection custody, saved run budget and existing tool dispatch. | One real read-only record is retrieved in personal and company-child chats. The answer and durable result remain after reload/restart. Wrong silo, withdrawn tool, revoked grant, stale lease/generation and unavailable credentials fail closed. Recovery cannot repeat dispatch or refresh the continuation allowance. |
| 2 / T2 | Review and approve a precise external change. IAM owns the decision and effect admission; elicitation owns the participant interaction; MCP owns execution. | T1 dispatch and connection binding; an authorized human approver, exact saved arguments and current permission at execution. | Show target, arguments/changed fields, consequences and connection owner before approval. One approval permits one exact effect. Reject, cancel, expiry, changed arguments, revoked membership/grant/connection and stale attempts prevent dispatch. A timeout after submission is durably uncertain and is never blindly retried. |
| 3 / M1 | Remember, recall, correct and forget information across conversations. The memory gateway owns fact content; the personal catalog owns metadata, consent and provenance. | Verified gateway-native dataset and stable deletion identity frozen in admitted authority; recoverable correction. | Remember a fact, recall it in a new conversation, correct it and forget it. Show consent/provenance/sensitivity. Other employees, silos and unentitled groups cannot recall it. Failed corrections/deletions can finish safely after restart. Never infer the dataset from a subject ID or rewrite an old run snapshot. |
| 4 / U1 | Follow and control assistant work. Existing conversation events, workspace stores and reusable components own the experience. | Durable activity/result events and the supported decision/cancellation contracts from T1/T2. | Proposed, running, waiting, failed, cancelled and completed work survives reload and SSE resume. Relevant decisions, result links and cancellation are accessible on desktop and narrow screens. Current access governs every read; projections never authorize work. |
| 5 / U2 | Use rich choices, forms and results in a conversation. Existing elicitation, A2UI and approved presenters own interaction. | Server-issued interaction identity, permitted audience, expiry and durable accepted responses. | Single/multiple choice, free text and structured results remain accessible after refresh. Stale, duplicate, modified and unauthorized submissions fail safely. Reuse component states, behavioural tests and visual fixtures rather than embedding complex interaction in routed pages. |
| 6 / F1 | Read documents and receive generated files. Artifact upload, quarantine/scan, input compilation and finalisation retain their owners. | Current artifact grants and scan result; model-readable content and lease-bound output finalisation. | Upload an allowed document, answer from its content, produce a downloadable file and reopen it after reload/closure. Unscanned/infected content stays unavailable. Other users and stale workers cannot read or finalise the artifact. |
| 7 / D1 | Delegate a bounded task to another assistant. Existing child admission, lineage, reservations and completion own the work. | T1 tool dispatch, current delegation grants, narrowed context/capabilities, root budget and cancellation. Memory/files are prerequisites only when selected context uses them. | A selected authorized child returns one terminal result or explicit failure. Prove depth/fan-out/concurrency/spend limits, sibling isolation, cancellation propagation, restart and target revocation. The child never implicitly inherits private tools, memory, files or credentials. |
| 8 / S1 | Create and manage scheduled work from a conversation. Existing managed definitions, admission and Absurd own durable firing. | Reviewed immutable routine, timezone/destination, current authority for each firing, overlap/missed-run policy and bounded retry. | Confirm a routine and its next firing; prove scheduled execution, run now, pause/resume, revision and retirement. Duplicate sweeps/restarts cannot repeat a firing. Revocation prevents the next protected effect; results/refusals remain linked to the exact routine. |
| 9 / A2 | Administer the company through the product. Existing protected APIs and settings owners remain authoritative. | The capability contracts introduced by T1/T2/M1/S1 and current membership/permission checks. | Configure one agent, connection, provider/model, tool selection and budget; inspect effective access/audit and actual recorded usage; revoke access. Employees cannot make admin changes or inspect secrets. Unknown costs are stated as unknown. |
| 10 / T3 | Resolve interrupted or uncertain actions. The invocation owner preserves receipts; protected user/operator controls request reconciliation and supported repair. | Durable exact effect identity, provider receipts/status lookup and a provider-specific safe retry contract. | Reconcile an uncertain effect without duplicating it, explain cancellation races, preserve every attempt and resolution, and expose supported safe retry or explicit manual resolution. Reload/restart does not erase uncertainty or invent success. |

Every track includes the safety required for its first useful journey. Full recovery is tenth;
idempotency, current authority, lease/generation fencing, bounded retries and honest failure states
are required from the first effect. Delegation and schedules do not depend on the whole recovery UI.

[#844](https://github.com/elewa-git/opencrane/issues/844) is the umbrella for the read-to-write journey,
including its controls and eventual recovery. Its full acceptance spans T1, T2, U1 and T3.
[#845](https://github.com/elewa-git/opencrane/issues/845) owns delegation completion, building on the
child-run foundations in #320. [#848](https://github.com/elewa-git/opencrane/issues/848) owns
conversational routines, superseding removed scheduling routes from #332.

## First execution wave: real tool retrieval

The review stack is `develop` → #831 (member access) → #843 (library/component decomposition)
→ #849 (Absurd turns) → [#850](https://github.com/elewa-git/opencrane/pull/850) (company tool selection). The first slice starts from immutable
base `b4f275b3f090e9387a1b0de658968700c0b7ad04` on `feat/0.12-real-tool-retrieval`.
Recheck live ancestry before publishing each PR; do not duplicate an open predecessor's patch.

1. **Enable company tool selection.** Port the existing unmerged company-tools work into
   `agent-services/main/src/company-assistants`, `revisions` and `execution-evidence`. GET/PUT uses
   current Administer/Assign decisions, immutable successor revisions, exact company-owned grants
   and an expected active revision. Preserve model/persona/skill attachments and the original saved
   budget. Only newly provisioned assistants receive the two-call policy. Fix nested Prisma
   assignments to inherit their parent service. Qualify transaction rollback, concurrent editors,
   removed/revoked grants and the separate company/human authority through unit and real SQL tests.
2. **Establish one working connection.** Inventory the authorized test environment and select a
   dedicated read-only integration and record. The current installation contract records
   `NeedsCredential` or `SharedKey` but provides no credential activation command. Define personal
   versus company ownership, authorized activation/reconnection and execution binding through the
   existing credential owner. A shared-key label alone is not connectivity proof. Keep secrets out
   of chat, workflow input and the ConversationComputer Pod. Missing setup produces an explicit
   content-free waiting state.
3. **Keep the retrieved evidence with the conversation.** Use the existing invocation result and
   history boundary to expose a minimal durable tool result/activity reference to authorized
   participants. The current lifecycle hook wakes Absurd but does not append participant history.
   This is the evidence needed to trust the first retrieval; comprehensive controls remain U1.
4. **Prove the real journey.** Retrieve the chosen record in personal and company-child chats, then
   reload and replace a server without duplicating dispatch, refreshing allowance or losing the
   answer/result. Exercise wrong-silo access, revoked company versus retained human grants, stale
   lease/generation and unavailable connection. Record exact candidate, configured integration and
   observed result separately from source tests and CI.

Architecture preflight passes for slice 1 using existing packages. A read-only integration selection
is still needed for live acceptance. Source implementation can continue while that choice is pending.
No connector credentials, installed integration inventory or live cluster state are assumed by this plan.

## Next wave: approved external actions

The current model selector and tool proposal reject approval-required tools, and the proposal intent
always records `approvalRequired: false`. Connect those paths to the existing IAM deferred-approval
owner. It already saves reviewed arguments, schema, action identity, expiry and the decision; use that
saved request at execution instead of accepting a new payload from the browser.

Extend the existing approval body and presenter to show the exact target, changed fields/arguments,
consequences and selected connection owner. The current generic label and revision identifier do not
suffice for a real external action. Resolve the entitled human participant explicitly for a company
assistant: the executing service Principal is not automatically the approver. This minimal presenter
belongs in T2 even though general rich interaction is fifth.

Use a dedicated fake-provider fixture for deterministic decision, tampering, revocation and ambiguity
tests, then one authorized real write for acceptance. A submitted request or approval click is not
proof that the provider completed the change. Broad provider-specific reconciliation remains T3.

## Ownership and delivery gates

Absurd owns durable progression, checkpoints, waiting and restart selection of saved steps.
AgentSandbox owns the isolated execution environment under current lease and generation coordinates.
The server owns model authority, credentials, budgets, tool permission, model calls, continuation and
conversation output. KurrentDB stores immutable history; PostgreSQL remains the current authorization
authority; the memory gateway owns long-term fact access. Do not add another scheduler, queue, outbox,
broker, credential store or Pod model scheduler. Replaced code is deleted completely.

For every coherent slice:

1. Select one user outcome and immutable review base. Read the owning code and package docs; run
   architecture preflight when responsibility/trust boundaries or package cohesion change.
2. Use independent implementation lanes with explicit file ownership. Preserve thin apps, capability
   folders, focused authority methods and reusable frontend components/stores. Component-manager
   pre/post applies to frontend changes. Consequential comments explain the contract in human language.
3. Run the relevant Nx tests, lint/type checks and build, plus required authorization, Prisma,
   workflow, app composition, dependency, style and module-growth checks. Real transaction/race claims
   require SQL tests. Reuse green evidence for unchanged code.
4. Run architecture post-review where required and the mandatory independent review against the
   exact base and source overlay. Resolve Critical/High findings, then update package docs, plan and
   functional changelog with the actual implemented capability and remaining proof.
5. Commit/push and open one incremental draft PR, state review order and exact validation, and
   inspect live ancestry. Merge, release tagging and testv5 deployment/qualification remain separate
   gates. Keep source completion, published CI and real user acceptance as separate statuses.

## Continuous qualification

Login continuity (R1) and member-access revocation (A1) retain their outstanding fresh-install and
real-account proofs. They are foundations alongside these priorities. Q1 adds each newly implemented
journey to full installation acceptance: sign-in, onboarding, personal/group answers, reconnect,
closed/revoked work, cross-silo denial, provider failure, backup/restore, usage and operator recovery.
No critical journey is called complete from a unit test, healthy Pod or successful dispatch alone.

Testv5/live qualification is a separate gate. Record immutable source/images, configuration, actors,
negative probes and observed outcome in the deploy ledger. Use app-owned deployment scripts for
any authorized cluster mutation. Pre-MVP installations retain one clean baseline with no migration
or compatibility scaffolding. Release scope and tags require their own explicit selection.

## Later work

Published applications, mini-app previews, internal CodeService and general code work are deferred
until after the ten priorities. Internal Git, broad marketplaces, warm pooling and extra compute tiers
are not prerequisites. Optional external-agent protocol compatibility does not transfer server
model/tool authority or durable ownership to external agents.

See also: [Active plan](../../plan.md), [product contract](personal-agent-platform-product-contract.md),
[workspace stories](../user-stories/workspace-and-conversations.md),
[conversation architecture](../adr/0016-conversation-history-and-computers.md),
[release policy](../agents/versioning.md), and [deployment evidence](../agents/deploy-ledger.md).
