# OpenCrane — Active Plan

## MVP continuation — 2026-09-22

The active goal remains the complete ten-track MVP, including delegation and scheduled agent work.
The current source slice adds read-only `/settings/audit` and `/settings/usage` on top of local
checkpoint `63e163d03f11b234c53ad571ad0d87fc5314866a`. It uses three narrow governance libraries:
generated read contracts and validators, their HTTP adapter, and a feature that composes separate
audit, recorded-usage and budget components. The browser app owns the existing Settings shell,
member children, new reporting children and adapter/reader-identity bindings. No grant, budget edit,
backend schema, live request or deployment is added. The access-policy decision remains open.

Audit traversal advances through permission-filtered empty pages. New tests caught and fixed a
cursor surviving a reader change, and pending reads surviving session loss; queries now reset with
the reader and all sibling reads cancel after a 401. A 403 clears only the denied endpoint, while
temporary read failures retain explicitly stale values. The usage endpoint has no sampling writer,
period or freshness evidence in this candidate, so this UI says recorded usage rather than live
spending. A returned global USD zero still cannot distinguish a default from a configured zero.

Current checks pass 25 contract, 17 adapter, 50 feature/store/mapper and 15 existing Settings tests,
plus 19 app-composition tests and all four library type checks. The production UI build and
Storybook build pass. A real Chromium run against the production-configured local app, with all API
requests intercepted as synthetic responses, passes at 1280 and 390 pixels: audit continuation,
Settings navigation, independent budget access, usage-denial purge, member default and anonymous
redirect. It issued GETs only. This is browser integration evidence, not a real-account journey.

The final full Storybook run passes all 242 interaction/accessibility checks in 38 suites. All 33
governance states render without browser errors or page overflow; 21 are tagged visual contracts
awaiting human baseline review. The new continuation button contrast, story-output bindings and
narrow grid sizing are repaired. Narrow fixtures and the routed app now assert that heading and
limitation text fit the viewport while tables retain their keyboard-reachable horizontal scroll.
The final production build, app-ownership guard and negative tests pass. Independent source review
finds no defects; style checks report zero errors/warnings and module growth reports zero candidates
across 37 production files. The live PR graph passes at snapshot
`22b08e644b960e17b26fb5d03822f761f6a82ee0e9289b4be19935a221a6851b`.
Local synthetic screenshots and their evidence limits are collected in
`/private/tmp/opencrane-governance-evidence.UlNM8e/REVIEW.md`. No shared permission rule or visual
baseline changed. This source slice remains local and unpublished.
Human visual review, publication/exact-SHA CI, deployment, actual usage collection and live
administration acceptance remain open; this is partial A2, not MVP completion.

Continue from reviewed candidate `830243b766d9ccb5f4719b511b082e3843b030db` (#898), with
`develop` at `d4bd0213c38e4fa70cbc3d93535857da9e381a32`. The live PR graph still places #898
after #888 → #891 → #892 → #893 → #894 → #896 → #897. Implementation uses the isolated
`feat/0.12-mvp-remote-authority` worktree; the older checkout and its unrelated edits are preserved.

The user explicitly approved two source changes on 22 September:

- Repair the remote-MCP database rules, retain hosted-tool safeguards, and update the fresh-install
  baseline. This supersedes the older pending source approval recorded below. It does not authorize
  changing a live database or calling a provider.
- Enable company-assistant approvals for the original requester only, while preserving the
  assistant's and connection's current explicit permissions. This supersedes the older company
  approver-policy/source block below. It does not authorize an actual external write.

Remote-MCP architecture preflight passes for separate, fully checked remote and OCI lifecycles.
New structural regression cases against the unchanged disposable PostgreSQL baseline reproduce
accepted null discovery digests and a null task connection, alongside the existing OCI-only claim
failure. The repair now passes all 361 MCP unit tests and 43 fresh-PostgreSQL remote authority
checks. Independent review reproduced a delayed completion accepted after its dispatch deadline;
the new regression fails against the first repair and passes after a database-clock completion
guard. All thirteen database test projects then pass on final baseline
`a9e8cd6e529c1ca9108e2811f5f08b47657b11e44d76811ddd62a20d17517d1f`, including three new
run-owned remote cases and the unchanged eighteen-case OCI proposal suite. The run-owned cases
prove original-run and current-computer lease caps, plus rollback of both claims and audits when
authority expires between writes. Independent integrated review and architecture post-review pass
for the scoped remote repair; the additional run-owned test delta also passes independent review.
MCP type checks, package boundaries, baseline regeneration and release binding pass. These are
disposable local PostgreSQL proofs, not authenticated Odoo or deployed-candidate acceptance.
No cluster, identity-provider, credential, visual-baseline, release or merge change has run.

The remote repair is committed locally as `b402f728f8869fb9d1029133f3e1f07919778286`; publication
is separately requested, with no push or new PR yet. Live stack integrity passes after that commit.

Requester-only company approval source is implemented above that checkpoint. Approval and
invocation rows keep the assistant's execution principal. Opening and deciding an approval resolve
the original human from the matching frozen run/invocation requester, then require a unique external
identity, current organization membership, active conversation participation and the linked
elicitation. Existing per-action Read/Decide grants remain temporary; no role-wide access or provider
credential borrowing is added. Pending detail, reconnect and Activity reads now check the exact
approval Read grant; resolved history retains its conversation-read policy.

The source checks pass 283 IAM, 155 execution-input, 737 conversation and 59 elicitation tests, plus
their type checks and the shared boundary/style checks. All nine approval PostgreSQL cases pass:
personal and company approve/restart with one continuation, hidden-value denial, expiry, wrong
requester refusal, revoked Decide, and revoked Read across detail, reconnect and Activity. The full
application database target passes 91 tests and four authority scripts on the disposable final
baseline. Independent integrated review and architecture post-review pass for the backend source;
the managed-assistant SQL test delta also passes independent review. No provider was called.
This backend slice is committed locally as `a78d05f607db1d56c2fac533119ae1580bb1d29a`; live
stack integrity still passes, and no push has run.

Connection-owner disclosure source is implemented through the existing approval body and card.
The IAM transaction resolves the selected execution owner's assignment, installation and immutable
remote connection before pausing the run. It freezes only the owner kind, display name and
credential requirement with the approval digest; the human requester is not treated as the company
connection owner. Hosted tools disclose credentialless execution. Replay preserves the saved
disclosure, and malformed or missing disclosure prevents affirmative decisions.

Validation passes 298 IAM, 187 contract, 70 elicitation API, 16 feature, 42 state and nine element
tests. All 93 application SQL tests and four authority scripts pass on the disposable baseline,
including eleven approval cases. The two new RemoteHttp cases prove real database disclosure,
requester-only decisions and one continuation request through the transaction-bound workflow port;
they do not prove a committed real Absurd event or execute a provider. Existing OCI handoff tests
remain intact. Generated client/API documentation, server and production UI builds, package type
checks, full dependency-boundary lint, style/Prisma checks and release coherence pass. The production
UI build succeeds with two workers outside the sandbox after two silent sandbox exits; no build
configuration was changed.

All 209 browser interaction/accessibility checks pass after correcting the stories' output bindings
and controlled draft feedback, with their event assertions preserved. Fifteen approval visual
comparisons have six unchanged states, two intended disclosure-row changes and seven new states
without baselines. Candidate screenshots are captured separately; no visual baseline is accepted
or updated. Source architecture and independent review cover the implemented responsibilities;
rendered correctness and component reuse pass review, while human visual acceptance stays open. This local
source checkpoint does not finish T2, qualify a deployed journey or authorize an external write.

The older #891 screenshot artifact expired on 20 September. Fresh local macOS Tools and Computer
Review/context candidates were captured from unchanged component source; they are not a
replacement for exact-head Linux CI evidence or human baseline approval. First-use private-memory
creation remains pending a separately requested source-only permission decision.

New company assistants now receive nine model calls, eight tool invocations and eight saved-result
cycles, replacing the remaining one-tool creation default. The aggregate 32,000 completion-token
allowance, two-minute deadline and null revision cost cap are unchanged; the existing server spend
cap still applies. Existing assistants and immutable revisions are not rewritten. Setup retries
leave their choices unchanged, and successive tool edits copy their saved budget.

The initial-budget regression failed against the old default and passes after this correction.
Five new controlled-provider tests use the actual company limits and 4,096-token route cap with the
real turn store and encrypted model custody. Later tool arguments are derived from saved result
contents. Eight calls feed a final answer, restart before model calls five and nine does not repeat
prior calls, a ninth tool response is refused, and expiry of the original deadline prevents further
model dispatch. Final model-token reservations are 4,096 for each of the first six calls, then 3,712,
1,856 and 1,856. This proves a positive final-answer reservation, not enough time or answer quality
for every business request. Provider execution, database and history-service transports remain test
doubles in these cases; they do not qualify real Odoo reasoning or a deployed company assistant.
Validation passes 167 agent-service and 742 conversation tests. Unit tests and type checks pass
across all nine affected backend projects; the server build, full dependency-boundary lint,
style/Prisma ownership, module-growth and release-coherence checks pass. The build's API generator
required permission to open its local IPC socket; no source or build configuration workaround was
needed. Independent integrated review passes with no findings. This source-only slice remains local
and does not close the live multi-step acceptance gate.

### Delegation restart and authority preflight

The current source checkpoint is `f4281ee6c0c8464de3eda6757f71198e424ebd21`. The live stack
check passes with the same seventeen open PRs and unchanged #898 head. A read-only inventory on
22 September found no source to port from `/private/tmp/opencrane-bounded-assistant-delegation`:
zero regular files remain, and its branch is still the old `8b20275` baseline, already ancestral to
the current candidate. The three old proposal/review directories are also empty. Rebuild against
the current owners; do not repair the old worktree metadata or treat its directory names as work.

| Existing owner | Required delegation extension |
| --- | --- |
| `execution/runs` | Root/parent lineage, shared allowances, reservation receipts and descendant cancellation. |
| `execution/inputs` | Current target identity, selected readable context and narrower frozen capabilities. |
| `server/conversations` | Model-owned delegation request, independent child history/activation and one terminal return into the parent's saved result sequence. |
| `iam/authorization` | Explicit current AgentService/Conversation Delegate decisions; declared actions are not grants. |
| `infra/workflows` | Reuse transaction-bound Absurd task admission and recovery; no new scheduler or peer messaging service. |

Architecture preflight blocks delegation activation, not reuse of these owners. Current Kurrent
counters and the model key limit belong to one run. A child cannot receive a fresh copy of that
allowance. In particular, a database debit cannot shrink a parent key that was already issued with
the full spending cap. Reserve disjoint parent-local and child/subtree spending allowances before
issuing credentials, and never reuse the parent's key for a child. Nested reservations must remain
inside the original root budget and deadline. Uncertain issued allowances cannot be refunded merely
because a worker restarted. The current model-key port has no shared-provider-budget contract.

Historical source reviews did not authorize the rejected reservation writer, Delegate grants,
delegation SQL or Prisma-owner registrations. A fresh scoped source request now covers lineage and
baseline changes, reservation/credential gates, opt-in delegation permissions, cancellation and
parent return. Proposed limits are two delegation levels, four children across the root task and
two active children at once; these are awaiting approval, not active product defaults. No automatic
organisation-wide grant, provider call, live database, deployment or publication is authorized.

Until that approval, work is limited to documenting the current boundary and characterization tests.
Five new conversation cases cover the null revision cost cap, a lower revision cap, a higher
revision cap, restart after the server configuration increases, and refusal of a changed frozen cost
cap. They run the real turn store and encrypted custody against controlled model/provider ports.
Three new run-cancellation cases keep two run rows in the same conversation: cancellation and its
replays leave the unrelated run untouched, and neither retargeting the saved Stop nor replacing it
with a second command is allowed. The IAM cleanup port is observed, not executed against providers.
All 747 conversation tests and 80 execution-run tests pass, with both package type checks. The first
restricted full run could not open test HTTP listeners; the unchanged rerun with local-socket
permission passed. No test or production configuration was relaxed. Style, Prisma ownership,
module growth and release coherence pass; these are local test/doc checks, not delegation proof.
The current-head rendered deployment inventory is not requalified by this source preflight. Actual
parent/child execution, depth-two return, sibling isolation, shared-cost enforcement, revocation,
restart and cascading cancellation remain required before D1 can be marked complete.

Keep the remaining memory, interaction, files, delegation,
schedules, administration and recovery journeys in scope; source completion never closes their live
acceptance gates. First-dataset memory authorization, governance-reader policy, visual acceptance
and testv6 identity/bootstrap still need their separately scoped decisions or approvals.

## Personal-memory SQL qualification — source repair validated

This follow-up starts at `8cd036502c5488848e3211850962ce9edcdd63e7` above the reporting
contract repair. CI on personal-memory command PR #896 found three failing SQL cases alongside
the separately tracked remote-MCP and visual failures. A fresh local database reproduced two
command failures with 11 of the 13 combined memory SQL cases passing.

The two memory suites share database tables. Running them separately removes unrelated fixture
writes that can exhaust a command's bounded Serializable retries; the explicit concurrent-command
race remains. A new case forces a retry after real task and operation writes, verifies that the
aborted task is absent, and proves one committed operation, audit and task survive a client restart.
An in-memory spawn receipt alone does not prove that its transaction committed.

The isolation-only experiment passes all 13 existing cases. The final combined 14-case SQL suite
then passes on three fresh PostgreSQL 17 databases, including actual Absurd admission and the
unchanged group-child SQL checks. Production retry limits, authority and the baseline are unchanged.
Independent review is required before publication. Remote-MCP SQL, human visual acceptance,
provider and testv6 qualification remain open.

## Administration reporting contracts — source implemented

This follow-up starts from the reviewed personal-memory command commit
`2da40813b8240dd07aaf1c03bcae6d633619c4f2` on `feat/0.12-governance-reporting-contracts`.
The administration screen preflight found a skipped-row pagination bug and public contract drift.
Correct these existing server owners before adding the read-only governance screen.

- [x] Audit pages carry both timestamp and row ID, matching their deterministic sort order. Equal
  timestamps, unreadable candidates and empty authorized pages cannot skip later visible entries.
  Invalid cursors fail with a bounded client error; the replaced timestamp-only path is removed.
  A positive fractional page size cannot round down to zero and prevent cursor advancement.
- [x] Audit response fields and pagination are accurately required in OpenAPI.
- [x] The mounted token-usage endpoint appears in generated clients with its actual account, token,
  currency, cost and optional ceiling fields. No monthly interval or percentage is inferred.
- [x] Existing budget reads and writes have truthful schemas and status codes. This slice adds no
  budget policy, permission, mutation route or form.
- [x] Owning tests, generated API, affected checks and independent review pass before publication.

Audit remains silo-bound and checks each candidate's current AuditEntry Read permission. Usage
checks current TokenUsage Read permission for each returned row. Organization role labels are not
substitutes for those decisions. Budget access retains current Organization Administer checks.
No database schema, grant, credential, UI, deployment or visual baseline changes belong to this slice.

Audit tests pass 16 cases, spend tests pass eight and the aggregate API spec passes six. The server
build, OpenAPI emission, client generation, website synchronization and all 80 affected lint/type
targets pass. Full ESLint boundaries, style/Prisma and module growth pass. Independent review passes
after limiting cursor IDs to the database integer range, keeping page sizes above zero and correcting
stale public-export docs. Authorization enforcement, its seven negative/contract tests and release
versioning also pass. These checks exercise synthetic local fixtures; no live administrative action ran.

The later governance UI will reuse the settings shell, section heading, resource feedback and table
primitives, with separate screen state, transport and presentation owners. Its component preflight
is prepared. Existing Owner/Admin bootstrap grants neither AuditEntry Read nor TokenUsage Read,
and no public generic grant-creation route supplies them. A separate user policy choice is pending
between organization-wide Owner/Admin access, a dedicated governance-reader role, or existing
per-record grants only. No automatic access was added. Company approver policy and the previously
recorded source/live approval gates remain pending.

## Consolidate, clean and qualify the MVP — 2026-09-13

The delivery order is now one cumulative draft PR against `develop`, followed by a code-quality
PR based directly on it. Fresh `testv6` will qualify the cleaned candidate. This replaces the
incremental publication order below; historical entries remain evidence for their original slices.

The cumulative candidate starts at #887 (`8b20275b692563b763e7e096262bd9586e2bcd2d`), includes
remote MCP #886 (`2b3876edd981cb8762fe8b533987fe6f84c4f586`) and the reviewed model-response
recovery change, and is checked against develop `d4bd0213c38e4fa70cbc3d93535857da9e381a32`.
Original branches were retained. The 22 September inventory found that the old delegation worktree
and proposal directories no longer contain source files; its branch has no delegation commits.
Historical reservation, grant and database proposals were not applied. Rebuild delegation from the
current candidate as described above before this can be called a complete MVP.

### Delivery checklist

- [x] Stop testv4, testv5 and other test workloads on the verified dev cluster. Keep the previously
  requested test data; use reviewed suspension tooling rather than the destructive teardown path.
- [x] Match cloud disks against Kubernetes volumes, retained claims, snapshots and VM attachments;
  delete only confirmed stale disks and record the exact resources and remaining costs.
  The reviewed suspension completed from `c661e6bf997f1bfe66dbf97faa51b3745c6496e2`: all six
  silos and shared application controllers are stopped. Retained 20 Bound volumes/380 GiB,
  seven snapshots, two SandboxClaims and two Sandboxes. That initial suspension deleted no disk.
  The final repair rerun at `239feb2fdaee3f8ef0a9bb750748c37c426e59d9` also completes its
  full retention comparison with both Sandboxes kept Suspended. GKE system services, its control
  plane and the retained load balancer/IP remain billable. A subsequent dependency and backup review
  qualified the obsolete `opencrane-sandbox` VM and its 30 GiB boot disk for retirement. Both are now
  deleted; all 14 verified recovery snapshots and the 20 current data disks/380 GiB remain.
- [x] Freeze the complete source inventory, resolve integration conflicts, validate the combined
  behavior and publish one draft against develop. Absorb predecessor PRs only after verifying their
  full inclusion, and retarget dependants so each change has one review location.
  Draft #888 is the cumulative review against develop at `9c3437c908eb4bbf0fa18a8e84de4c62227420b7`.
  All 35 fully absorbed predecessor PRs are closed; their branches and unrelated local work remain.
  Stack integrity passes. Incomplete delegation proposals remain outside this source inventory.
- [x] Review the cumulative diff across backend authorities, model validators, persistence,
  workflows, API/contracts, frontend components/state, package boundaries, deployment and tests.
  Record each verified finding, its owner, the fix and its validation in the follow-up quality PR.
- [x] Delete superseded routes, implementations, exports, configuration, tests and docs together.
  Preserve required behavior and reusable component states. Split responsibilities when their
  ownership or dependency direction differs; file length alone is not a reason to split.
- [ ] Run independent architecture preflight/post-review, independent code review, relevant Nx
  tests/lint/type/build checks, Prisma/workflow/authorization boundaries, workload and domain
  guards, style, module growth, release-baseline validation, API generation and UI contracts.
- [ ] Finish the remaining product journeys below before marking the MVP ready; cleanup is not
  proof that delegation, scheduling, memory integration or administration is complete.
- [ ] Build immutable images for the cleaned SHA, deploy a fresh testv6 through the app-owned
  scripts, and test authenticated journeys plus restarts, revoked authority and uncertain effects.
  Record exact image digests, test evidence and remaining failures. Close the goal only when its
  agreed functional acceptance is met. No release tag or merge is implied by this deployment.

### Code-quality review scope

Inspect long field-by-field conditions against their model-owned validators; duplicated domain
algorithms; transaction ownership, lock order and retries; durable state transitions; package
cohesion and dependency cycles; app roots that hide business logic; broad public barrels; unused
or superseded code; exception handling; comments and stale documentation. For the frontend, trace
complete pages through their stores, mappers and reusable components, including accessible states,
refresh/recovery behavior and visual coverage. Each deletion needs a verified surviving owner or
proof that its capability is no longer used. Findings remain open until the fix and its tests pass.

Retain the focused capability and type maps established by #843. App source stays bootstrap-only;
libraries keep capability/role folders, explicit Nx dependency direction and narrow package barrels.
Consolidation must preserve these boundaries even when an older PR is absorbed or closed.

### Final code and testv6 preparation checkpoint

The cleanup code at `a2560d903f3b5b799e90c3343dc4282c1853c714` passes the CI build/test/lint job
for 93 projects plus one dependency, including the production Angular build. The dedicated Cognee
provider contract, history recovery, API generation and three applicable generic image smokes pass.
Storybook passes 202 interaction/accessibility checks and 133 unchanged visual states. The five
remote-MCP database failures and 22 intended visual candidates remain the two recorded approval
gates; the existing macOS and Linux galleries remain the human review targets.

Testv6 DNS now resolves to the retained ingress at `35.205.225.244`, with the wildcard, base and
sibling records unchanged. The current Zitadel client rejects the exact testv6 callback as absent.
The scoped administrator-session and callback-change approval is pending after automatic approval
review blocked private-session inspection. No identity-provider, credential bootstrap, shared
controller restore or fresh testv6 deployment has run. These preparation results do not complete the
remaining functional MVP journeys.

The published ordered-loop commit `c737beca00f9b9fdb156ab6d438a7a583f8fc523` passes affected
build/test/lint, generated API, KurrentDB recovery and all three applicable image smokes in run
`34792406250`. Its PostgreSQL proposal (18), approval (3) and tool-result (4) cases pass. The five
existing remote-MCP database cases still fail; Storybook visual review also remains open. This run
publishes no images and does not qualify testv6. Live stack integrity passes for #888 → #891 → #892.

Gateway PR #893 at `ff714f3a844583a614e401a1627e0ab089eb12f3` passes affected build/test/lint,
generated API, KurrentDB and three image smokes in CI run `34808953810`. Only the same five remote-MCP
baseline cases and 22 screenshot candidates fail; 133 unchanged visuals pass. No images were
published, and the dedicated Cognee image contract was skipped. Its live stack and corrected stack
CI pass for #888 → #891 → #892 → #893.

### Existing personal-memory commands — source implemented

This slice starts directly above draft #894 at
`5599c88a4a632ee414644e19d713cb77c0b31eb4`, on
`feat/0.12-personal-memory-product-commands`. It completes the authenticated command transaction
for an already Active personal dataset with an adopted provider identity and current explicit
MemoryScope grants. It does not create a dataset or grant, and therefore cannot provide the first
Remember journey until the separate first-dataset authorization work is approved and implemented.

Conversations owns caller resolution, exact human-message preparation, the command transaction and
the content-free operation response. Personal-memory retains dataset/fact metadata and operation
persistence. Central `admitPrincipal` must record the concrete Manage or Forget decision bound to
the command digest in the same transaction as operation admission and the Absurd task. Worker
revocation checks cannot stand in for this admission evidence. Read access must be checked before
returning a saved operation to its authenticated owner.

- [x] Architecture and memory-boundary preflight confirm the existing-grant admission contract.
- [x] Remember, Correct and Forget admit one exact operation and task; retries cannot create another.
- [x] Missing, Provisioning or Retired datasets fail closed with no creation or permission fallback.
- [x] Current principal, membership, dataset, target revision and selected-source authority are checked.
- [x] An authorized content-free status read survives command-response loss without dispatching work.
- [x] Focused Nx and real PostgreSQL tests prove authorization, replay, concurrency and rollback.
- [x] Owning documentation, generated API, applicable checks and independent review are complete.

The conversations suite passes 730 tests, personal-memory passes 60 and the server passes 169.
A disposable PostgreSQL 17 installation of the unchanged baseline passes eight command-admission
tests and five catalog tests, plus the existing child-authority suite. The admission proofs use the
real Absurd task API: concurrent and restart retries retain one operation, task and audit decision;
an exception after task creation rolls all three back. Current grants and membership are required,
and status reads separately require Read. The disposable database is stopped. Server build, OpenAPI
emission, client generation and website API synchronization pass. All 80 affected projects pass
lint/type checks; full ESLint boundaries, style/Prisma and the relevant ownership guards pass.
The expanded HTTP suite passes nine cases and API contracts pass four. Independent review found
and corrected an impossible conflict response in the GET documentation, removed a superseded denial
class and corrected stale package claims. Integrated review and architecture post-review pass; the
command transaction's responsibilities remain cohesive, with catalog writes and workflow effects
owned by their existing packages.
These source proofs do not qualify a live Cognee or testv6 journey.

Company-action approval also needs a policy choice for its human approver. The existing requester,
organization role and connection ownership do not supply that entitlement. Its implementation
handoff is prepared separately while this existing-grant memory slice proceeds. The pending remote
MCP SQL, first-dataset grant, visual review and testv6 identity/bootstrap approvals remain unchanged.

### Personal-memory saved-phase worker — source implemented

The next slice starts from gateway PR #893 at
`ff714f3a844583a614e401a1627e0ab089eb12f3`, on `feat/0.12-personal-memory-workflow`.
Its source preflight identifies three owners: the personal-memory repository loads validated saved
operations; the conversations authority selects and records one lifecycle step; app bootstrap
registers that handler on the existing Absurd engine. No product command route, new grant, database
model, credential path or worker runtime is added.

The task must match its saved silo, operation, task ID, name and retry key before provider work.
Current external-principal membership, dataset ownership, MemoryScope Manage/Forget permission and
source evidence are checked again at the relevant step. Replayed checkpoint receipts pass the shared
strict schema before any lifecycle event. The Absurd adapter renews the current claim immediately
before an uncached effect for the configured external-call timeout plus a minute; a stale claim
cannot enter the callback. Slow provider pre-reads happen before that renewal. Each effect callback
contains at most one gateway request, and catalog authorization and writes share one transaction. This uses Absurd heartbeat, with no additional queue or timer loop.
Completed receipts survive restart through named checkpoints. A concurrent revision winner is
reloaded, and uncertain mutations keep their recovery phase; retries cannot replace saved operation
identities. The gateway continues to own its provider-specific reconciliation protocol.

Validation passes 722 conversations tests with four workers, 169 server tests, 59 personal-memory
tests and 38 Absurd unit tests. One opt-in Absurd SQL case is skipped by its ordinary unit target and
passes through the dedicated `test:sql` target. The unchanged baseline installs in a disposable
PostgreSQL 17 database; all 13 personal-memory SQL tests and five authorized catalog SQL tests pass,
as does the existing child-authority SQL suite. The catalog proofs cover commit, current revocation,
conflict recovery and rollback. The Absurd SQL proof rejects a reclaimed worker before its effect
and lets the replacement execute once. One initial full-suite run timed out under concurrent load;
the affected router passed alone and the complete 722-test rerun passed with four workers.

All eight affected packages pass lint/type checking. The server build and API generation, full
ESLint boundaries, TypeScript/Prisma style, workload/domain guards and negative tests, workflow and
authorization guards and negative tests, release checks and pre-publication stack check pass.
Module growth has no errors; the two saved-phase owners have reviewed responsibility inventories.
Independent review corrections cover pre-dispatch errors, corrupt receipt replay, late checkpoint
persistence failure, catalog revocation/conflicts, lease timing and already-committed revision winners.

This prepares execution but does not enable first-dataset admission. Its separate grant approval,
product commands and complete live memory journeys remain outstanding. That later command unit of
work must record central authorization evidence bound to the command digest in the same transaction
as the operation and Absurd task. This worker only rechecks revocation of already-admitted authority.

### Personal-memory gateway steps — source continuation

This slice starts at `c737beca00f9b9fdb156ab6d438a7a583f8fc523`, the published ordered-tool-loop
commit in draft #892, on `feat/0.12-personal-memory-gateway-steps`. Architecture preflight passes
for the shared contract, private gateway and existing server client. Provider operations and server
transport now use the content-free deletion receipt. Validation passes 75 private-gateway tests,
14 server-client tests, 162 shared-contract tests and 12 app/harness tests, including seven cases
through both real HTTP adapters. All 80 affected packages pass lint/type checking. Full ESLint
boundaries, workload/domain guards and their negative tests, release-manifest validation and
TypeScript/Prisma style checks pass. Module growth has two reviewed responsibility inventories.
The connected harness has explicit Nx test/type-check cache inputs outside the production package
graph. Independent review found and fixed pre-dispatch Ensure/Delete read failures that incorrectly
reported ambiguous mutation delivery. Independent integrated and architecture post-review pass. The remaining Low port-comment finding
is corrected: mutation methods document the failure classes and when the caller must reconcile.
The memory-gateway production bundle also builds successfully. Published as draft #893 at `ff714f3a844583a614e401a1627e0ab089eb12f3`, directly on #892.

The private gateway owns dataset/document operations through its existing authenticated Cognee
session. The server client sends one request per method and validates every receipt against the
requested coordinates. The later personal-memory workflow remains the sole owner of saved phases,
waiting and recovery; this slice does not register that worker or expose product commands.

Replace the three unused, throwing personal-write methods with dataset/document step methods.
Keep the public query and scoped-memory APIs and their existing consumers. Replace the old inbound
search path with the shared memory-search contract on both ends; Cognee's upstream route remains
inside the provider adapter. Delete superseded validators, receipt helpers and claims with the
replacement. No new queue, schema, deployment or credential path is needed.

First-dataset authorization remains blocked on the existing explicit source approval for
`MemoryScopeCollection/Create`. Its recorded automatic-review rejection covers the persistent
active-member grant expansion. The earlier ten-file client deletion proposal is not applied: this
narrower edit preserves the working APIs, transport entrypoint and caller integration. Source tests
will cover request authorization, delivery ambiguity, exact receipt binding and query regressions.
Complete Remember/Recall/Correct/Forget journeys and testv6 qualification remain later gates.

### Bounded multi-step tool reasoning — added MVP acceptance

The ordered-turn implementation wave starts at immutable review base
`d3986cc15c611f8aef836cd77ea420267dd2174c` on `feat/0.12-bounded-tool-reasoning`
(draft #892, above #891). Architecture preflight passed. Three coordinated lanes replaced the
fixed turn protocol, ordered private model history, and proposal/result workflow together. The
source now supports repeated tool reasoning. Final validation passes 678 conversations tests,
160 contracts tests, 192 model-routing tests, 161 asset tests and 159 application tests. Nx affected
lint/type checks pass for 80 projects; style, Prisma ownership, module-growth, workload and agent
boundaries pass. Final independent review and architecture post-review pass with no remaining
findings. The source is published in #892 at `c737beca00f9b9fdb156ab6d438a7a583f8fc523`;
provider backoff and live qualification remain.

The 22 September continuation removes the separate one-tool default from newly provisioned company
assistants while retaining their existing aggregate token, time and spend limits. Its focused
content-dependent eight-tool/restart proofs are recorded above; existing company revisions remain
unchanged and live business qualification stays open.

The one-tool result and text-only continuation was an earlier delivery slice. The complete
MVP must support a repeated model → MCP call → persisted result → model cycle within one run.
Absurd continues to select the next saved step and own waiting and recovery. The server owns model
and tool authority; AgentSandbox owns isolated, lease-fenced execution. No second scheduler is added.

- [x] Freeze explicit model-call, token, tool-call, elapsed-time and loop limits at admission.
  Revision authoring, compilation and recovered snapshots preserve the complete allowance.
- [x] Debit every new ordered step from that same allowance; repeated recovery and continuation
  never replenish it. The ordered protocol replaces the fixed one-tool runtime ceiling.
- [x] Carry each saved call/result pair into subsequent model requests in order, allowing another
  permitted tool selection before the final text answer. Two-tool and saved-result restart tests
  exercise the real turn store and encrypted custody.
- [ ] Qualify discovery-dependent sequences, pagination and intermediate reconciliation with
  ordinary provider tools; an aggregate `inventory_total` tool is not a substitute.
- [ ] Apply bounded backoff to proven retryable provider responses such as HTTP 429. Save the
  retry decision and deadline in the existing workflow. An uncertain effect remains unavailable
  for redispatch unless its existing recovery contract proves a safe outcome.
- [ ] Recheck the exact tool revision, connection/credential version, product permission and active
  execution lease/generation for every call. Only the original requester may approve or cancel
  MVP external writes; a loop iteration does not inherit an unbounded approval.
- [ ] Persist visible progress and results across the loop, and stop further model/tool admission
  after cancellation, ended authority or a defined limit.
- [ ] Test restart at each model/tool dispatch and result boundary, no duplicate paid model request
  or uncertain external effect, unchanged remaining allowances, durable response-unavailable state,
  pagination and 429 backoff, revoked authority, requester approval, cancellation and loop exhaustion.
- [ ] On testv6, complete a discovery-dependent multi-call business journey with pagination,
  reconciliation and a grounded answer, plus an approved write and its recovery/cancellation cases.

The provider-backoff preflight confirms that read-only MCP discovery already uses bounded Absurd
retries. Generic effectful `callTool` responses, including HTTP 429, remain `MaybeDispatched` and
enter recovery without another call. `Retry-After` supplies a delay, not proof that no effect
occurred. Automatic effectful backoff needs a trusted adapter contract proving rejection before
tool admission; that contract is absent from the current generic remote MCP registration.

The source loop builds above the completed quality fixes. Provider backoff and live qualification
remain functional gates alongside memory, delegation, scheduling and administration before the
goal can close. The singular reservations, fixed Kurrent revisions, singular continuation custody
and one-invocation proposal clamp are deleted together. Ordered reservations, aggregate accounting
and distinct per-step proposal identities now enforce the admitted limits.

Admission limits, the exhaustive State × Event table and repeated proposal/result progression now
use the existing Absurd and IAM owners. Keep model
transport single-request. Reserve a final model call before admitting another tool; if the remaining
allowance cannot support a grounded answer, end through the existing durable unavailable outcome.
Carry the ordered accepted tool-result history into subsequent model requests under the existing
private custody and context bounds. Restart tests must precede pagination and approved-write live
qualification. Retry a rate-limited action only when its current adapter/recovery evidence proves
that another dispatch is safe.

### MVP continuation after cleanup — 2026-09-14

Source work resumes on `feat/0.12-bounded-tool-reasoning`, with immutable review base
`11b90e30a420f9c10485ce658ceb22d0a894408d` from cleanup PR #891. The integration reference is
develop `d4bd0213c38e4fa70cbc3d93535857da9e381a32`. The live stack check confirms
#888 → #891 before this wave. Keep the completed cleanup review stable while the remaining
functional work builds directly on it.

Cleanup CI also finishes on that exact base in run `34785528321`: build/test/lint, generated API,
the Cognee provider contract, history recovery and all three image smokes pass. Its only failed
checks remain the five remote-MCP SQL cases and 22 screenshot candidates already awaiting approval;
133 unchanged screenshot states pass. No images are published from that failed draft run.

| Wave | Result required before the next wave | Existing owner |
| --- | --- | --- |
| 1. Aggregate admission limits | Validated limits survive revision storage, input compilation and recovery without defaults that renew an allowance. Keep the current one-tool ceiling in place. | Agent revision models, agent services and execution inputs/runs. |
| 2. Ordered turn protocol | An exhaustive State × Event table and saved per-step identities replace fixed first/continuation slots; restarts and competing appends cannot repeat a paid request. | Conversation turn state, private input custody and model reservations. |
| 3. Repeated tool reasoning | Each saved tool result can inform one next model step under the same aggregate limits, with current permission and lease checks. | Conversation model flow, proposal admission and existing IAM invocation lifecycle. |
| 4. Waiting and recovery | Absurd resumes exact steps after approvals, rate limits and restart; uncertain effects remain fenced and cancellation ends further admission. | Existing turn workflow and invocation recovery. |
| 5. Business qualification | Testv6 proves discovery, pagination, reconciliation, a grounded answer and an approved write with recovery and cancellation. | App-owned deployment and authenticated live journey tests. |

Admission, protocol and architecture analysis run concurrently. Implementation lanes split by their
actual files after the shared contract is settled. Memory operations, delegation, scheduled work
and administration remain subsequent MVP requirements. The pending remote-MCP SQL, visual review
and scoped Zitadel callback approvals are unchanged; they do not prevent independent source work.

The first slice keeps the current authored model-call, completion-token and duration limits and
adds explicit tool and cycle limits. That slice allowed eight personal tool-result cycles and one
company cycle; the 22 September follow-up permits eight cycles for newly created company assistants.
A cycle means one distinct saved tool result that may feed a later model
step, not an Absurd delivery attempt, sleep or retry. The ordered-step wave above now removes
the earlier one-tool runtime ceiling. An explicit null revision spend cap means the existing
frozen server spend cap applies; no new dollar default or unbounded spending mode is introduced.
The adjacent workflow prerequisite binds approval and remote-dispatch checkpoints to the exact
invocation ID, preserving idempotent replay while preventing reuse across different calls.

The first slice passes architecture preflight and independent integrated review. Review removes the
unused attempt-credential helper and its private types, removes a repeated deadline check already
owned by the shared validator, and corrects the token contract to describe generated tokens only.
The live conversation owner remains responsible for its key and frozen server spend cap.
Focused suites cover the contracts (158), agent models (39), agent services (163), inputs (155),
runs (77), conversations (660), model routing (190), personal configuration (65) and server (159).
Affected type checks pass for 81 projects and three dependency tasks; dependency, Prisma, workflow,
authorization, style, module-growth and release-manifest checks pass. SQL-backed qualification will
run in CI; no SQL baseline, release digest or screenshot baseline changes in this slice.

### Cleanup findings and evidence

Draft #891 (`feat/0.12-mvp-quality-cleanup`) is based directly on #888. Keep findings
and validation here until the complete review is recorded; a passing mechanical scan does not
close a responsibility review.

| Finding | Owning change | State and validation |
|---|---|---|
| Conversation prerequisites depended on the literal silo name `testv5`, so a new `testv6` could bypass them. | `apps/_infra/deploy-k8s` enforces the existing KurrentDB and AgentSandbox contracts for every deployment and checks the final Helm values before a cluster write. | Complete deployment contracts pass. Independent review caught Helm overrides of checked identities/runtime; final merged-value schema constraints and override tests resolve that finding. Post-review passes. |
| Existing teardown deletes retained test data. The live inventory includes six silos and four MCP Deployments managed outside Helm. | Add an app-owned suspension operation with exact ownership checks and preserved storage identities. | Source and execution review pass; live shutdown completed and retention was verified. All 20 current cloud data disks map to Bound volumes. The later backup review qualified the obsolete VM and its separate 30 GiB boot disk for retirement; both are deleted with all 14 verified snapshots retained. |
| Remote MCP claims reach the OCI-only database trigger. | Complete the reviewed remote transport constraints and lifecycle fencing in the fresh-install baseline. | Current CI and local SQL prove the failure. The concrete source proposal remains unapplied pending explicit approval and fresh PostgreSQL acceptance. |
| Memory provider deletion leaves source bytes after the final membership is removed. | Promote the qualified Cognee 1.5.4 profile into the sole production image and remove the superseded provider and candidate lifecycle. Compose authenticated provider access inside the existing memory gateway library. | Cognee 73, gateway 43, app 5 and client 18 tests pass, with builds, type checks and full deployment contracts. Independent architecture and source review pass after build-owner registration and stale-comment repairs. The full Docker-backed provider contract passes on #891 at `c66303d6`; fresh-silo live qualification remains pending. |
| The growing Storybook catalogue shares a single three-minute screenshot-test deadline. | Discover one Playwright test per tagged state from the built catalogue and compare that discovery with the served index. | Before the component-state changes, all then-existing 150 visual checks passed locally in 4.8 minutes with existing screenshots and tolerances. Each state has its own browser context, deadline and failure report. Independent review passes. |
| Personal and managed execution admission duplicate command and lease comparisons; the personal path omitted the returned computer ID. | Share pure coordinate validators inside the existing execution-inputs subject owner, retaining separate identity/permission policy and read order. | All 142 input-assembly tests and type checks pass, including 18 substitution cases across both public authorities. Independent review passes. |
| Assembly's exported result repeated strings already owned by documented outcome enums. | Type the final result with those enums and explicitly map the lower admission result at the boundary. | All 142 input tests and type checks pass. Source-loader states retain their separate contract owners. Independent post-review passes. |
| A later sign-in or display-name edit made an exact saved-message retry conflict with its original immutable author metadata. | A pure message-retry validator preserves the saved name/authentication time while comparing stable actor coordinates and all command content. Current authorization still runs before recovery. | All 655 conversation tests and type checks pass; independent review passes. |
| Stop constructed private cancellation events outside the turn owner and could select a head newer than the state it decoded. | The turn store prepares validated cancellation and settlement appends from its loaded revision; Stop retains atomic composition with its receipt and log. | Independent preflight and post-review pass; all 655 conversation tests and type checks pass, including progression between read and append. |
| An unused runtime eligibility adapter and approval-internal exports remained public after replacement. | Delete the unused agent-service adapter, contract, self-test and boundary registration; keep approval internals behind the live transaction entrypoints. | Repo-wide consumer inventory confirms no production caller. All 161 agent-service and 249 authorization tests pass, with type checks and independent deletion review. |
| Malformed saved tool authorization was swallowed and reported as ended authority. | Preserve the integrity error through the existing workflow trace while withholding the result; retain explicit unavailable outcomes for current lifecycle and coordinate mismatches. | All 249 authorization tests and the type check pass, including malformed evidence that cannot be consumed. Independent post-review passes. |
| Agent identity categories duplicated persisted strings across admission, validation and output owners. | Add one documented identity-kind enum in contracts and reuse it at the existing boundaries without changing wire values. | Six affected packages pass tests and type checks, including 136 contract and 53 identity tests. Independent post-review passes. |
| Seven conversation event publishers duplicate the same durable ID algorithm. | Move the byte-identical algorithm to one conversation-computer helper; retain distinct ID schemes with different inputs or versions. | All 658 conversation tests and the type check pass. Independent review confirms unchanged domain and input bytes at all seven replacements. |
| Conversation entry categories duplicated stored strings across their types, parser and consumers. | Add documented presentation enums beside the entry contract, retain a distinct phase set for each log subtype, and reuse the existing message-state owner. A total frontend phase map requires an explicit display for future tool phases. | Architecture preflight and independent post-review pass. All 142 contract tests and the type check pass; 392 comparisons with the old parser preserve acceptance and parsed bytes. The consumers pass conversation 658, history 30, inputs 142, workspace 58 and onboarding 32 tests, with type checks. |
| Tools defines a second base input, select and button system, including inputs without visible focus. | Compose the existing PrimeNG controls in the current feature components and delete the unused duplicate styles. | The source repair passes 32 Tools tests and the type check. All 202 Storybook interaction/accessibility tests pass. Seventeen intended control screenshot changes on each of macOS and Linux await human review. The production Angular template build passes after correcting the options array type. |
| The active Computer Review panel has no canonical visual or section-navigation coverage. | Add focused populated, busy, error, narrow and keyboard fixtures, preserving the existing state owners. | Source and keyboard repair pass all 58 workspace tests and the type check. Five new states on each of macOS and Linux await human review. On each platform the 155-state visual run passes the other 133 committed states unchanged. |
| Retained Sandbox objects can request Pods when the shared controller restarts, and a completed suspension cannot be rerun after Pods disappear. | Persist their existing controller's suspended operating mode under exact ownership and version checks; accept already-absent Pods without accepting foreign or durable workloads. | Focused suspension and full deployment contracts pass, including substituted ownership and persistent volumes without a Pod. Independent review passes. The `c66303d6` repair persisted both retained Sandboxes as Suspended, then stopped at an unnecessary Pooler write because the CNPG webhook was offline. That attempt did not complete its full retention comparison. The repaired `239feb2fd` rerun subsequently completed the comparison with both Sandbox/Claim identities preserved; shared controllers remain stopped. |
| Repeating a completed suspension still writes stopped CNPG resources after their admission webhook is shut down. | Give the existing PostgreSQL suspension operations their own file and skip a write only with valid saved ownership and stopped-state evidence. Retain phase order, version fencing on changes and the final identity comparison. | The focused suspension contract passes with a rejecting webhook, and rejects foreign or missing ownership. Complete deployment contracts and independent post-review pass. The live rerun from `239feb2fd` completes the full before/after retention comparison; all six old silos remain stopped. |
| Lower input loaders and admission callbacks repeat result strings across different owners. | Define source-load, build, existing-verification and final-admission enums at their current type owners; explicitly map refusals between them. | Inputs pass 142 tests and runs pass 74, with both type checks. Raw fixtures retain independent wire-value assertions. Independent post-review passes after restoring the idempotency and persistence-retry guidance. |
| Execution evidence and artifact preprocessing repeat their owned outcome strings. | Reuse the evidence owner's enum across its consumers and keep each artifact result's permitted subset explicit. | Agent services 161, inputs 142, conversations 658 and artifacts 97 tests pass. Independent post-review passes; the unused artifact enum barrel export was removed. |
| The authenticated memory profile requires a safely provisioned existing service-user Secret. | Add a create-only operator helper with explicit cluster, namespace, name and email, private credential files, ownership checks and immutable rerun validation. | Focused and complete deployment contracts and independent security/architecture review pass. Registration remains disabled by default. The separate testv6 bootstrap operation has not run. |
| PostgreSQL and KurrentDB bootstrap passed generated passwords in process arguments. | Keep password bytes in private temporary files, pass file paths to kubectl and remove those files after success or failure. Existing Secret identity, type and rerun behavior stay unchanged. | Focused contracts prove file permissions, six password creations, absence of password bytes from arguments/output, and success/failure cleanup. Full deployment contracts and independent security post-review pass. |

The final source overlay passes all 90 affected lint/type-check targets. Style reports zero errors
and two reviewed schema comparisons: Prisma's skill publication state and the group-child
persistence state carried through its ORM-neutral port. Neither introduces a second state owner.
Module growth reports zero hard-limit errors; its responsibility candidates remain tied to the
owning independent reviews. API generation leaves both the generated client and published OpenAPI
unchanged. Intentional frontend baseline approval, remote-MCP SQL and exact-image/live qualification
remain separate open gates.

PR #891 CI at `c66303d669c05c470ee349a4d58c5d5e402e9037` passes the full Docker-backed Cognee
provider contract, KurrentDB history recovery, generated API/client checks, three other image smokes
and all 202 Storybook interaction/accessibility tests. Its corrected stack metadata check passes.
The generic Cognee image-smoke target was independently wired without the arguments required by
the same smoke script already run in the full contract; the reviewed repair removes that duplicate
target and selects the full contract directly for Cognee changes. Its 24 selector tests pass.
The affected build found one Angular template type error in the Tools filter options; the type-only
repair passes the production UI build and produces identical JavaScript. The remote-MCP database
suite still passes 10/15 pending its separate SQL proposal. Both platforms' 22 intentional screenshot
candidates still require human review. All 554 frontend unit tests and type/lint targets pass across
32 projects. Workload ownership and agent-domain boundary guards pass. The repaired commit still
requires CI; immutable image publication and fresh testv6 qualification remain open.

### Consolidation validation checkpoint

The combined application passes 159 tests and its type check; the conversation owner passes 653
tests and its type check; MCP passes 361 tests and the remote client passes 52, with both type
checks passing. The server build passes. Prisma boundaries, workflow boundaries, authorization
enforcement and the current release manifest pass. The cumulative style scan reports no errors
and 51 categorical-string warnings to classify in the cleanup review. Module growth checks 907
production source files with no hard-limit errors and 58 responsibility-review candidates.

The fresh-database remote MCP suite passes 10 of 15 cases. Four remote claims are rejected by the
existing OCI-only runtime trigger, and one malformed-revision case encounters the existing earlier
trigger rather than the intended transport constraint. The previously rejected remote-runtime SQL
proposal is still unapplied. This is a recorded blocker for the cleanup and testv6 acceptance, not a
passing integration claim. Application SQL passes all 82 cases and four SQL authority scripts;
the full quality review remains in progress.

### Live acceptance

Testv6 must prove real remote and hosted retrieval, approved external actions, consented memory
remember/recall/correct/forget, visible progress and Stop, rich interaction after reload, scanned
input documents and downloadable generated files, bounded delegation, scheduled work, administration,
and safe action recovery. Exercise original-request and continuation restart safety, unchanged
allowances, durable response-unavailable state and stale lease/generation rejection across the
bounded multi-step loop above. Keep the existing one-tool continuation tests as regression evidence
for that earlier slice. Preserve the boundary between local/CI evidence and completed live journeys.


## Model response recovery — source validation

This bounded fix starts directly above draft #887 at
`8b20275b692563b763e7e096262bd9586e2bcd2d` on `feat/0.12-model-response-recovery`.
The conversation history already prevents another paid model dispatch after an uncertain response,
but the corresponding run could remain Running. The workflow now persists `RecoveryRequired`
before returning `response_unavailable`, including when a late response reaches error recovery.
Failure to save that state keeps the workflow pending. Restart accepts the same run attempt and
lease without resuming it or replenishing the original or final-call allowance.

The change reuses the conversation workflow and execution/runs lifecycle. It adds no endpoint,
scheduler, schema, grant or recovery action. Bounded assistant delegation remained unfinished in
its separate worktree at that checkpoint; the 22 September inventory now requires rebuilding it.
Its reservation and grant proposals were not part of this patch. Runs (74), conversations (651), the full application SQL target and application tests/type check/build
pass locally. Independent source review passes. This fix is included in the cumulative candidate;
testv6 and live provider qualification remain pending.

## Visible tool work — published, CI repair

This U1 slice is published in draft #887 directly above draft #885 at
`ede0c912224a6e73404880458380520d4639dcd0` on `feat/0.12-visible-tool-work`.
The remote MCP integration is an independent sibling in #886; its pending runtime database guards
must not become a dependency of this existing hosted/personal work-visibility slice.

The existing transcript renders requested, running and terminal tool entries. This slice adds the
missing producers: requested is saved after proposal admission, and running after an actual hosted
execution claim. Terminal results and approval notifications keep their existing owners. A pending
result alone never reports that execution started.

Architecture and component preflights pass at this base. The conversation history producers and
hosted post-claim callback are implemented. Progress uses stable tool-call IDs and private atomic
receipts to survive reload, stream resume and uncertain history append without duplicate entries
or dispatch. Current access controls every read, and a late progress event must not replace a
terminal state. Reuse Absurd, conversation history and the existing status-line component; do not
add polling, a scheduler, a queue or another authoritative status store. Architecture and component
handoffs require phase-specific atomic receipts and a fresh current-claim check after history
publication before the companion command is returned. Receipt recovery proves history durability
only; it never renews execution authority. The terminal publisher still precedes final-model
reservation, so progress failure cannot replenish or consume a replacement model allowance.

Local validation passes 648 conversation tests, 199 MCP tests, 143 application tests and 81
application PostgreSQL tests, plus four SQL authority scripts. The new SQL cases verify current
claim evidence, substituted coordinates, grant revocation, computer generation changes and expiry.
Two joined route/database cases recover a lost history acknowledgement within the original claim
request, release the original command once, and withhold it when permission ends during publication.
A test fixture now supplies its membership timestamp as an explicit UTC string; production
membership checks are unchanged. Both library type checks, the application type check and server
build pass. Workload and agent-domain boundary guards and their negative tests pass. An approval
fixture timed out during the parallel validation run; the unchanged full SQL target passes on its
sequential rerun, including both new route cases.

The real-Kurrent integration target includes the new recovery and ordering cases, but its store
cases are skipped locally because no Kurrent URL is configured. Full architecture post-review
passes. Independent review led to same-call lost-acknowledgement recovery and clearer state comments;
its bounded follow-up review passes with no remaining findings after the final comment correction.
CI run `34761057932` at `ded7bbb7836bbd49b12a528d58ed165d4f52db41` passes
affected build/test/lint, the real-Kurrent history proofs, generated API and stack checks.
Its database job failed on one existing MCP readiness assertion: task-owned claims now return
the command envelope with no conversation-run receipt. The assertion now checks both fields;
production claim behavior is unchanged. All five MCP PostgreSQL cases pass against the same fresh
baseline, and package lint, style and Prisma-boundary checks pass. Fresh CI remains required after
this test correction. No live tool call, deployment or testv5 qualification is claimed by these checks.

History that remains unavailable after the hosted SQL claim cannot authorize command release. The
existing expiry worker closes the invocation and run as recovery-required. That no-redelivery
boundary also survives a server restart; recovering a history receipt never renews a provider claim.

## Memory indexing receipts — source reviewed

This M1 slice is published in draft #885 at `ede0c912224a6e73404880458380520d4639dcd0`,
directly above #884. Its source CI run `34755914962` passes; provider and k3d qualification were
skipped. It is independent of the remote MCP integration in draft #886. The gateway's locked document snapshot now carries metadata and a content digest;
indexing requests and completed receipts retain the caller-saved operation and provider pipeline.
The adapter rejects mismatched and unfinished responses without exposing fact text or storage paths.

Independent review found that valid uppercase UUIDs conflicted with the provider's lowercase
responses. The correction normalises UUIDs before sending or comparing them, rejects document
duplicates across letter case, and checks result-map cardinality before normalisation. Contract
tests (136), gateway tests (29) and both package type checks pass. Independent review closes the
UUID finding with no remaining issues. Final style, Prisma boundaries and module-growth checks
pass. The reviewed source is published above the unchanged #884 head.

Client cutover, first-dataset grants, credentials, chart promotion, provider calls and product
activation remain outside this slice. Remember, cross-conversation recall, Correct and Forget
still need their complete product and provider integration.

## Standard remote MCP integration — source reviewed

Draft [#886](https://github.com/elewa-git/opencrane/pull/886) publishes this source directly above
#884. The reviewed fixture correction is pushed at
`3c95770188ede00259b4d438c735c284ab6deede`, and live stack ancestry passes. Its first
database CI job stopped while creating test rows: the fixture's first-preparation
time preceded its default creation time by milliseconds. Both fields now use the same database
clock value. The corrected 15-case local SQL run passes 10 cases and reaches five remaining runtime
failures: four remote claims still enter the existing OCI companion trigger; the invalid-revision
case receives the earlier activation-authority rejection instead of the expected constraint name.
These failures remain visible. No SQL guard, exception or test exclusion was added, and runtime
acceptance is still incomplete. The existing proposal and its authority/error expectations must be
qualified together when that source change is authorized.

The first Linux component job passed interaction checks but found eight missing visual references
for the new connection states and one changed Removing row. The component owner reviewed all
nine actual renders from artifact `10317302520` and accepted their exact bytes as Linux references.
Removing now shows its saved removal state and a disabled Uninstall action. No component, fixture,
threshold or test selection changes are needed. Tools tests (32), Storybook interaction/accessibility
tests (195), the Storybook build and Darwin visual checks (3) pass; Linux rerun remains pending.
The provider job reproduced the known Cognee
1.2.1 defect: final membership deletion leaves source bytes. This is separate from remote MCP
execution, and the qualified candidate has not replaced the production pin. Both failures remain
release gates; neither is suppressed by this source checkpoint.

The preserved remote MCP implementation is being integrated directly above draft
[#884](https://github.com/elewa-git/opencrane/pull/884), at immutable review base
`7e2c3f523e719de7c72354551edcea6b9aeb5829`, on
`feat/0.12-standard-remote-mcp-integration`. The original unpublished worktree at
`749b50058f6503653d203b5a7caf98926076cf08` remains untouched. Its 226 changed paths and
separate source overlays are preserved at `/private/tmp/opencrane-remote-pre-884-preservation`.
The latest source and stack checks for both #883 and #884 pass; hosted k3d tests were skipped.

Earlier reviewed remote work implements connection admission, immutable credential custody,
connection-specific discovery, write-only personal controls, and server-owned calls through the
existing ToolInvocation and Absurd owners. Those earlier local checks do not qualify this newly
integrated source. The integration retains the current personal tool-selection APIs, model-facing
aliases, generated-file workflow and memory persistence rather than replacing them with the older
branch versions.

The integration now sends remote results through the transaction-scoped result participant used
by hosted tools, then persists only its accepted result. Ordinary remote read results remain
supported. Embedded resources and remote use of the reserved CSV producer are rejected before raw
file bytes can enter tool-result storage. Remote calls carry their real connection and claim proof;
they do not invent OCI companion or Job coordinates. A rejected result preserves the saved dispatch,
so recovery cannot call the provider again. Completion rechecks both invocation authority and the
remote claim deadline after result preparation. An application regression also proves that an
opaque model tool name selects the admitted revision and sends the original MCP name to the client.

The integration passes 1,303 tests across MCP (355), conversations (630), conversation assets (159)
and the application (159). The latter three results are reused after the MCP-only cancellation fix.
Connection UI, client transport and workload-identity packages pass a further 159 tests and their
type checks. Storybook passes 195 interaction and accessibility tests. The complete 15-case MCP SQL run now
passes 10 cases and exposes the five runtime failures
recorded above; no runtime case is excluded from that corrected run. Prisma generation, baseline
verification, dependency and Prisma boundaries, workload composition, release binding, style and
module-growth checks pass. Production server and UI builds pass, and regenerating the API client
and website reference changes no bytes. Workflow and authorization guards and the workload and
agent-domain negative tests pass. Deployment contracts and Helm lint pass locally; the contract
harness warns that system Bash 3.2 does not enforce every assertion, so Linux/Bash 5 CI remains
required.

Architecture post-review and independent review pass. The reviewed timing correction carries the
database's remaining claim allowance into a monotonic executor deadline. Credential retrieval and
provider I/O consume that same allowance, and completion rechecks fresh database time after result
preparation. Remote execution owns its allowance independently of the OCI companion lease.
Cancellation now reaches the Kubernetes Secret request; a database lookup that returns after the
deadline cannot open a Secret request or call the provider. Focused cancellation regressions and
the full 355-test MCP suite pass. This reviewed source is prepared for a draft checkpoint.

The separately reviewed runtime SQL guards and unused custody-field removal remain unapplied and
await their existing explicit approvals. The merged baseline only carries source already present
in the preserved branch and current parent; it does not apply either rejected proposal. Runtime SQL
acceptance, Linux visuals, complete remote/provider qualification and hosted certificate trust remain
open gates. No live provider call, existing credential inspection, deployment or testv5 data change
is included. The full ten-track MVP goal remains active.

## Hosted generated-file journey — source implementation and prerequisites

This F1/T1 qualification slice starts directly above draft #883 at
`db68c8a744a3869bb5854a57414fc134c242d31a` on
`feat/0.12-hosted-generated-file-qualification`. Separate tests already prove the producer image,
server capture, scan authority, saved answer/recovery and participant reads. The next proof must
connect real hosted execution to captured bytes, an actual clean scan, the saved answer and an
authorized identical-byte download after restart in the existing disposable k3d harness.

Architecture preflight rejects an injected in-Pod workflow driver and approves the production
server as the sole activation/Absurd worker. A disposable OpenID Connect login fixture and synthetic
OpenAI-compatible provider must drive real public login/message/read APIs and actual model requests.
The existing instance LiteLLM owns model and credential administration; its deployment wrapper owns
the master and encryption keys. The complete proof must
upload, scan, validate/import, promote and discover the real OCI-layout ZIP through a TLS registry;
no Imported or post-admission workflow state may be fabricated. Independent implementation lanes
own the platform fixtures/helpers and the application public client/evidence bundle. CI mapping now
includes the controller, scanner, companion, skill-authoring worker and producer; its 24 regression
tests pass.

The preserved fixture work now includes reviewed personal-tool selection PR #882 through the
chart prerequisite #883. The personal selection parent passes validation workflow `34748052273` and corrected stack workflow `34748262396`
on `ad3123f3b0b9235c368509cec9401bae94acd246`. The earlier stack attempt failed before the PR body
named its own review position; the source commit did not change.

The public bridge is being implemented through real login, invitation, model/default, persona,
onboarding and conversation-directory APIs. A first-user Owner invites the separate requester as
an Admin. After actual MCP discovery, publication and installation, the requester uses the real
`GET/PUT /api/v1/me/agent/tools` owner. The fixture may resolve the resulting Principal through the
existing read-only directory and add one exact synthetic tool Assign grant before selection. It
must never manufacture a personal revision, its publication, tool Use/Invoke grants or workflow
state. The PUT accepts only the expected active revision and selected tool revision IDs.

Once its prerequisites pass, the runner is wired to execute prepare, validate and qualify, then
restart the owned server and artifact service and invoke public verification. It waits for every
prior Pod to terminate. The two fixed
OIDC identities are bound through authorization-code exchange; unknown or missing identity hints
fail. After restart and exact command replay, the Owner removes the requester through the existing
member API. The still-authenticated requester must receive the explicit membership denial.
Closing a conversation or logging out would not prove that current membership is enforced.

Offline platform checks cover the two-identity protocol, credential cleanup, wrong-context and
foreign-deployment rejection, restart waiting/timeouts, exact model-call counts, and evidence
retention. The smoke copies only named public evidence and image/byte digests into CI artifacts;
its credentials, checkpoints and generated file contents remain outside the artifact. The app
bridge is implemented. No complete k3d qualification has run.

Automatic approval review rejected optional production outbound CA trust. The exact source-only
proposal at `/private/tmp/opencrane-additional-ca-source-proposal.md` passes independent review and
explicit approval is pending; no trust change or substitute Pod/image injection is applied.
Only newly generated fixture identities and credentials belong to this CI work. Testv5 and
existing databases remain outside the slice.

The actual server-trust render now fails before cluster or credential creation when the proposed
certificate bundle has no production consumer. The independently reviewed shared-LiteLLM fixture
was replaced with the required instance mode; fake model/key administration and its unused master
Secret were removed. Automatic approval review also rejected the public synthetic-provider setup
source patch because it forwards a key into provider configuration. The exact rejected proposal is
preserved at `/private/tmp/opencrane-hosted-byok-source-proposal.md`; no key was sent and no rejected
source was applied. A reviewed safer variant is now implemented: the client and synthetic
provider use only the public literal `opencrane-hosted-fixture-public-marker`. The client accepts
no upstream key or provider URL, requires a loopback transport and disposable `.opencrane.test`
origin, and derives the provider URL from the validated namespace. The confidential upstream key
generation, state and Secret mount are deleted; evidence access keeps a separate random key.
This exercises the normal public provider-registration path with public test data. It does not
qualify a real provider or credential. All 28 client tests, the application bundle, lint/type checks,
style and Prisma boundary checks pass. The full deployment contract suite and Helm lint also pass.
Final review found no Critical or High issues. Its bounded corrections now give every public/login
request a deadline, close a stalled TLS socket on cancellation, validate named API projections
through adjacent typed schemas with explicit field stripping, and retain failure logs from scanner
and executor namespaces. The corrected source is frozen for final review of those changes.

Enabling the real governed workers exposed a missing YAML document separator before the MCP
admission policy in the agent-controller chart. The source repair keeps network and admission
resources separate and extends the owning Helm test to parse their actual rendered documents.
The five-file repair is independently reviewed and published separately in draft
[#883](https://github.com/elewa-git/opencrane/pull/883) at
`db68c8a744a3869bb5854a57414fc134c242d31a`, directly above #882. Its controller tests, full
manifest parse, Helm lint, workload boundary, release binding, style and growth checks pass.
The latest stack workflow and exact-commit source CI run `34749913713` pass: seven jobs succeeded
and five conditional jobs were skipped. The hosted
worktree is now restacked directly above #883; the named stash and all 41 pre-restack file copies
remain preserved at `/private/tmp/opencrane-hosted-pre-883-preservation`.

The parent memory-candidate repair is published in draft
[#881](https://github.com/elewa-git/opencrane/pull/881). Its ten-file change passes 72 offline tests,
lint, architecture and independent review, patch/postimage verification and stack integrity.
Exact-head candidate job `103688043992` in run `34743783263` passes all 31 named cases. Its retained
artifact `10313735048` verifies the repaired source postimages, owner-root contention, serialized
add/delete orders, shared-file cleanup and both interrupted-cleanup recoveries across restart.
The overall run is red only because production-pinned Cognee 1.2.1 still leaves source bytes after
final membership deletion. Replacement topology run `34743803938` passes. Source-only replacement
preflight is now tracing the audited candidate into the production owner and checking existing
gateway compatibility. That audit found two concrete deployment gaps: the candidate runs as
UID/GID 1000 but the current chart does not arrange PVC ownership, and the deployment disables
Cognee authentication while the candidate's negative control proves ACL-disabled search can
return a foreign dataset chunk. The current gateway forwards search only and leaves mutation
transport unavailable. Source-owner consolidation can be planned, but candidate digest activation
must wait for storage ownership and authenticated gateway integration to be reviewed and qualified.
No candidate promotion or testv5 deployment has occurred.

## Governed MCP chart rendering — validation and review

Hosted generated-file qualification exposed a missing YAML document separator between the
agent-controller NetworkPolicy and the MCP ValidatingAdmissionPolicy. The enabled controller
render fails YAML parsing before deployment. This prerequisite starts directly above draft #882
at `ad3123f3b0b9235c368509cec9401bae94acd246` on
`feat/0.12-mcp-admission-chart-documents`. It restores the document boundary without changing
network rules or admission expressions. The owning Helm contract now parses the complete manifest
and checks that the controller network policy, MCP admission policy and binding remain separate
resources. The isolated controller tests and Helm lint pass, as do workload-ownership, release
baseline and module-growth checks. Independent review of the five-file overlay passes with no
findings. Draft #883 publishes the reviewed source at `db68c8a744a3869bb5854a57414fc134c242d31a`;
exact-commit CI run `34749913713` passes, with seven successful jobs and five conditional skips.
The full hosted journey, pending certificate/provider setup and testv5 qualification remain
separate work; this repair does not qualify a live tool invocation.

## Personal MCP tool selection — source reviewed and CI passed

This T1 slice starts above draft #881 at `001bd730244727a37d47c3f82455f45fec9fd39f`
on `feat/0.12-personal-mcp-tool-selection`. A person needs to assign discovered tools to their
personal agent before a real hosted tool can participate in an admitted conversation. The existing
personal revision owner selects models and personas only; the company tool API owns a different
kind of agent and cannot supply this missing personal configuration path.

Architecture preflight passes. The existing agent-services package owns authenticated
`GET/PUT /api/v1/me/agent/tools`. Selection requires the caller's current personal AgentService
Edit permission and an existing Assign permission for each selected Ready tool on an Active,
Published server. It never grants Assign. A changed selection uses the canonical revision writer,
preserves non-tool content, publishes one successor and switches the active revision within a
Serializable transaction. The existing personal authority reconciles exact Use and Invoke grants
for the selected tools; an empty selection removes this manager's grants without disturbing
independent grants. A stale expected revision conflicts, including after an uncertain successful
response. Model and persona changes must preserve the tool selection.

Parallel implementation lanes delivered production, unit/router checks and real PostgreSQL proofs
of authority, rollback, competing writers and restart reads. The six personal SQL cases pass on
a new disposable database, alongside the five existing company SQL cases. The full server database
target passes 74 cases and four authority scripts. The server's 115 unit/composition tests,
configuration and onboarding tests, package type checks, server build, generated API/client and
boundary checks pass. Prior fixture databases and testv5 remain preserved.

Independent review identified one unchanged-selection gap: a permitted re-save returned success
without restoring missing assignment-managed Use/Invoke grants. The corrected no-op reconciles
those grants without creating a revision; the SQL proof also verifies that a revoked Assign
decision rolls back that repair and preserves independent grants. Focused unit checks pass after
the correction. Architecture post-review and independent review of the final source and its
transaction comments pass. Draft #882 publishes the exact reviewed commit; its validation workflow
`34748052273` and corrected stack workflow `34748262396` pass. No schema, default permission, company route
or workflow changes belong to this slice. The dependent hosted generated-file harness stays in its separate worktree and must
use this public owner after review; complete hosted qualification also awaits the separately
pending optional outbound CA support proposal.

The immediate parent #881 now passes all 31 replacement-memory candidate qualification cases,
including shared-file contention and interrupted cleanup recovery. Its unchanged production
provider still fails final source-byte cleanup. Candidate authentication, storage ownership and
gateway integration remain separate M1 work; no provider promotion or deployment has occurred.

## Memory candidate shared-file coordination — candidate qualification passed

This M1 repair starts above draft #880 at `949ab198db37b7dceb7325857cc00f8daf26076f` on
`feat/0.12-memory-candidate-shared-file-lock`. The production memory provider remains unqualified.
The 1.5.4 replacement candidate passed run `34740821230`, but a prior identical candidate run
returned HTTP 500 for a missing shared source file. Offline diagnosis found a concrete mismatch:
the delete-first fixture locked the global storage root while an authenticated server add locked
its owner's root. Its timing check did not establish that the add was waiting on that lock.

The repair now resolves both dataset contexts through the provider's owner-scoped storage root.
A distinct task must time out when it tries to take the target dataset's lock while the source
dataset's lock is held. The public cleanup wrapper takes that same existing reentrant lock before
opening its database session. All earlier shared-file, source-byte, deletion, isolation and restart
assertions remain. Patch and resulting-source attestations are updated together in the candidate
profile, expected hashes, Dockerfile and image-smoke fixtures. The production image, base-image
digests, source preimage, gateway, permissions and existing databases remain unchanged.

Architecture preflight passes. The frozen implementation passes 72 offline Cognee tests and lint;
architecture post-review and independent source review pass with no findings. Style and module-growth
checks contain no production TypeScript/Python files because the runtime change is an attested
candidate patch; reviewers must inspect that patch and its resulting source explicitly. Release
binding remains coherent. Draft #881 publishes the repair at
`001bd730244727a37d47c3f82455f45fec9fd39f`. Exact-head run `34743783263` passes all 31 candidate
cases and retains artifact `10313735048`, including source attestations, owner-root contention,
shared-file deletion and interrupted-cleanup recovery across restart. The same run fails the
separate production-pinned Cognee 1.2.1 contract because final deletion leaves source bytes.
Production replacement and the complete personal-memory journey remain unfinished.

## MCP tool names across model selection and runtime execution — implementation

This T1 slice starts directly above draft #879 at `774940fb7479e0529c738a265f8de7d2cfa82809`
on `feat/0.12-mcp-model-tool-names`. Architecture preflight approves a direct replacement in the
existing compiler, model gateway and conversation selection owners. A tool's exact MCP `name`
remains frozen with its immutable revision. A separate required `modelName` is derived from that
revision for provider declarations and responses. The compiled digest covers both names and the
compiler version changes; there is no fallback to the old dual-use name contract.

Parallel source lanes cover compilation and first-party declarations, gateway selection and
recovery, and an application integration proof from persisted discovery through exact MCP dispatch.
Duplicate runtime names are permitted only for distinct revisions with distinct model names.
Permission, approval, schema and argument checks still use the original revision evidence. No
credential, grant, scheduler, database schema or MCP executor authority changes in this slice.
Library and application independent reviews and architecture post-review pass. Contracts (135),
execution inputs (124), personal configuration (65), model gateway (190), conversations (628),
MCP gateway (193) and application composition (115) tests pass with their lint/type checks. The application SQL target passes
74 cases and four raw authority scripts on a new disposable database, preserving prior fixtures.
Server build, full dependency lint, style, Prisma ownership, module growth, release binding and
24 CI-workflow regression tests pass. The new PostgreSQL/Kurrent target compiles and its local
prerequisite check passes; its complete case is skipped without Kurrent and must execute in CI.
The integration now follows the real compiler, model transport, saved selection/custody, IAM
admission and companion claim, then recovers with fresh clients without repeating the model call,
invocation or runtime execution. Draft [#880](https://github.com/elewa-git/opencrane/pull/880) publishes the source at
`949ab198db37b7dceb7325857cc00f8daf26076f`, directly above #879. Exact-head CI run
`34742576506` passes source checks, database authority, KurrentDB recovery, generated API,
Storybook and selected image smoke/publication jobs. Its actual PostgreSQL/Kurrent log proves one
MCP model-name integration case and four generated-file recovery cases executed and passed; no
real case was skipped. Each suite's inverse services-unset sentinel was skipped as expected.
Memory-provider qualification and live k3d checks were unaffected and skipped. Replacement
topology run `34742697410` and the live post-push stack check pass. This does not qualify remote
or hosted MCP operation on testv5.

The parent CSV correction's exact-head CI run `34740821230` passes its combined PostgreSQL/Kurrent
generated-file recovery step, source checks, database authority, API, Storybook and image smokes.
The run completed with one failure: the existing production memory-provider contract. The 1.5.4
candidate passed this run. Offline diagnosis found that the earlier delete-first fixture acquired
a global file lock while the server used an owner-scoped lock, leaving its claimed serialization
unproven. The lock mismatch is confirmed; it is the likely explanation for the intermittent error.
A bounded fixture/cleanup correction and deterministic synchronization proof now pass in #881. Replacement
topology run `34740838698` and the post-push live stack check pass. F1 still needs its pending SQL
guard and the separately qualified governed OCI-to-download journey.

## Generated conversation files — implementation in progress

F1 continues above draft #878 at `5acd38a6f6dec8a0dc4fa4e010bf7a9b9e73b37d` on
`feat/0.12-conversation-generated-tool-files`. Completion means a permitted OCI tool produces a
file, the server captures and scans it, the assistant attaches its published revision, and the
requester can download identical bytes after refresh or restart. Producer tests alone do not close F1.

The first producer is `opencrane_files_create_csv`, an actual credentialless MCP image owned by
`apps/mcp-file-generator` with protocol and CSV logic under
`libs/backend/agents/runtime/mcp-file-generator/main`. Existing OCI promotion, installation,
revision assignment, invocation and workload fencing remain the execution boundary. This change
adds no automatic installation, agent assignment, permission grant or cluster deployment.

The producer implementation passes its focused build/test/lint checks, including 17 CSV/protocol
and loopback HTTP tests plus the app image contract. CSV media policy passes five model tests and
lint. Independent producer review passed before the shared CSV model extraction; the integrated review
of that extraction, resource validation and encrypted custody passes. Capture persistence,
metadata-only MCP completion, workflow persistence and scanner publication checks are implemented
locally. The actual capture and scanner PostgreSQL/Absurd proofs pass, and the combined final-answer recovery proof passes CI at `774940fb7`.

The server integration must preserve these ordering rules:

1. While the original MCP completion claim is current, validate the admitted tool/revision and
   personal requester authority, reserve stable artifact/asset/task coordinates, and capture bytes
   encrypted in the same transaction as the metadata-only terminal tool result. The raw completion
   digest remains the retry identity. Neither terminal JSON nor conversation events carry file text.
2. Absurd owns promotion, receipt recovery and scan waiting. The MCP Pod can finish after capture;
   it does not wait for publication or schedule the server's next model call. Publication starts
   with a Quarantined revision and the existing scan job; only a clean scan can make it Ready.
3. The turn waits for that saved file outcome, then uses its original remaining continuation
   allowance. Output preparation and append recheck access and attach only the saved Ready revision.
   Lost responses recover the same output intent and asset/message link.

The shared CSV model now lets the server re-render admitted arguments and reject any changed
file bytes, including formula injection, before capture. The producer no longer owns a separate
copy of that policy.

The existing private-payload cipher caps text at 64 KiB while files can be 1 MiB. The file custody
implementation must preserve the ordinary text limit and authenticate the complete file's ordered
payload references, length and content digest. The generic artifact upload finalizer publishes
without scanning and cannot be used unchanged for these untrusted bytes.

The process now registers the generated-file task and passes its transaction-bound authority to
the scanner. That workflow uses IAM's existing server system actor; it does not retain the departed
MCP Pod as its caller. Current run, requester, membership, assignment, computer generation and
original deadline checks still apply. Scanner completion records task wakes after its final database
state is readable. A wake failure aborts completion.

Focused scanner tests pass (10 artifact cases and 8 conversation-asset cases), as do the 9 internal
HTTP/composition tests and Prisma ownership checks. MCP completion passes 54 focused tests; the
companion suites pass 22. The actual MCP capture suite now passes four PostgreSQL/Absurd cases, and the scanner suite passes
15 cases with the real current-authority composition, both durable task wakes, expiry and rollback.
Those tests exposed a shared Absurd adapter bug: Prisma cannot deserialize PostgreSQL void. The
event adapter now executes the same function while returning a supported scalar; the real scanner
proof passes with that correction.

The generated-result reader now blocks continuation until the saved scan outcome is terminal and
rechecks the original requester's Artifact read permission. The model sees a metadata-only publication
outcome beside the original tool payload; the original result digest and remaining allowance stay
unchanged. Focused continuation tests prove restart waiting and refusal of a changed saved outcome.
Independent review of this result integration passes.

The answer now saves Text plus at most one exact Ready Artifact using the existing atomic history
commit. The link owner reloads that receipt and binds the asset before run completion. Focused tests
cover link failure, changed attachments and settlement after an already-linked answer's lease
expires. Frontend mapper and content-store tests cover refreshed AgentOutput CSV downloads.
Independent final-output review passes with no findings. The assembled PostgreSQL/Kurrent proof
passes CI at `774940fb7` after the exact producer-name correction.

Final-output architecture post-review passes, including the seven module-growth candidates.
The broad local source run passes 920 tests; the full server SQL target passes 73 cases plus its
raw authority scripts on a new disposable database, preserving earlier fixture databases. Server
build, regenerated OpenAPI/client artifacts, release binding, CI workflow regression checks and
the live PR-stack preflight pass. The combined capture/scan/answer recovery suite compiles and is
registered as `opencrane:test:generated-file-integration` in the existing PostgreSQL/Kurrent CI
job. Its local run skips without both services and is not evidence that the combined proof passes.
The suite starts from the saved first model dispatch and uses the production continuation path
with a synthetic final model transport and candidate resolver. Its admitted 384-token allowance
has already spent 128, leaving 256 below the model route's 512-token ceiling; the assertions require
that exact remainder and one model dispatch across recovery. Current lease/Pod authority has its
separate PostgreSQL proofs; this fixture does not replace them.

The delivery audit found missing production dependencies in the CSV image workspace. They now
match the bundle's external imports and use versions already locked by the repository. The new
app-owned `image-smoke` builds and starts the production image without a network, then tests
discovery, tool listing and exact CSV output over container loopback. Static checks and independent
smoke review pass; real container execution belongs to CI. Authorization inventory now records
the generated-file Create decision separately from participant asset mutations, and its checker
and seven regression tests pass.
The final full dependency check also passes after exposing the existing MCP completion command
enum through its gateway facade and declaring the asset owner's workload-identity type dependency.

Draft [#879](https://github.com/elewa-git/opencrane/pull/879) publishes this source checkpoint at
`499813fe4f7e0c6bf9c619c6b22618f8ce6c28e3`, directly above #878. Independent review has no remaining
findings. CI run `34739668909` at that source SHA passes the production CSV image smoke, database
authority proofs and generated API. The new combined recovery suite fails during fixture setup:
the owned producer advertises a dotted name that production copies unchanged into model
declarations, whose name validation rejects dots. There is no production alias mapping. The fix
renames the real producer, capture allowlist and fixtures together to `opencrane_files_create_csv`;
a fixture-only alias is rejected, and the declaration validator remains unchanged. The correction
passes independent review and all 21 source-manifest hashes match. Focused model, MCP gateway,
asset and producer suites pass 17, 193, 153 and 5 tests respectively, with lint/type checks,
producer build, style, Prisma boundaries and module growth passing. The complete proof and
corrected combined proof now passes in run `34740821230` at `774940fb7`. Source, database, API,
Storybook and image checks also pass. That run remains red only for the existing production
memory-provider contract. The live stack
check and replacement stack CI run `34739775866` pass after recording the complete ancestor review
order; the branch contains the current `origin/develop`. This source checkpoint does not close F1.

The earlier CI run `34739668909` failed both memory-provider qualification jobs. The production pin retains its
known source-file erasure gap. The 1.5.4 candidate returned HTTP 500 while adding a shared file,
reporting a missing provider-owned `shared.txt`; its prior passing run does not establish repeatable
qualification. No Cognee harness source changed in this PR. Candidate root-cause diagnosis remains
open. The candidate passes the next exact-head run `34740821230`, but neither that pass nor the
persistence slices qualify the complete memory product.

The additional PostgreSQL once-only message-link guard is proposed but unapplied: automatic approval
review requires explicit approval of that exact production baseline mutation. The concrete source
proposal is `/private/tmp/opencrane-generated-file-message-link-source-proposal.md`. Existing testv5
data is not part of this source proposal. Remaining work includes that guard and the assembled
answer, download, restart and authority qualification. Hosted MCP, delegation and later priorities retain their existing scope.
The full MVP goal stays active; testv5 and real uploaded-OCI qualification remain separate gates.

## Personal memory catalog completion — transaction integration

This slice starts above draft #877 at `5618b277157b9601fdd3527c3fc423bcd1247f9e` on
`feat/0.12-personal-memory-catalog-completion`. Its parent passes exact-head CI in run
`34727906356`, including affected build/test/lint, database authority, KurrentDB recovery, generated
API, component contracts and server image publication. Provider qualification was unaffected and
skipped; testv5 remains a separate gate.

The existing personal-memory operation repository will compose catalog mutations with accepted
operation transitions. The lifecycle planner retains all state/event decisions; PostgreSQL retains
fact revisions and correction constraints. Catalog mutation precedes the operation compare-and-set
in the same transaction. A lost operation write after a fact mutation must abort the transaction.

| Saved operation state | Accepted event | Catalog effect and next operation state |
| --- | --- | --- |
| Remember, CatalogCommitPending | CatalogCommitted | Create the exact Active fact and complete the operation together. |
| Correct, CatalogCommitPending | CatalogCommitted | Create one Active successor; PostgreSQL marks its prior Active fact Corrected at revision R+1. Advance to PriorDocumentDeletePending. |
| Forget, CatalogFinalizePending | CatalogFinalized | Change the exact ForgetPending fact from R+1 to Forgotten at R+2 and complete the operation together. |
| RecoveryRequired with one of these saved recovery phases | Matching accepted catalog event | Apply the same catalog transaction through the existing lifecycle planner. |
| Stale revision, wrong kind/phase or completed operation | Any catalog event | Deny before a fact write; preserve the saved state. |

Architecture preflight passes. Direct message facts use server-selected personal sensitivity,
Explicit consent, the operation UUID as fact identity and content-free Message provenance.
Implementation passes 51 unit tests and all 13 personal-memory PostgreSQL cases, including six new
completion, duplicate/restart and rollback proofs. The server SQL target also passes its 48 cases
and raw authority scripts. Package lint/type checks, server build/OpenAPI, style, Prisma ownership,
module growth and release binding pass. Architecture post-review and independent review of the
complete nine-file change pass with no blocking findings. This source slice does not add a grant,
public route, gateway transport or worker; the pending first-dataset permission and gateway
replacement remain separate decisions. Draft [#878](https://github.com/elewa-git/opencrane/pull/878) publishes the change at
`5acd38a6f6dec8a0dc4fa4e010bf7a9b9e73b37d`. Exact-head CI run `34729341100` passes
affected source checks, database authority, KurrentDB recovery, generated API, component contracts,
stack integrity and the server image. Unaffected provider and live smoke checks were skipped.

## Personal memory command preparation and atomic task admission

This slice starts directly above draft #876 at
`7c1bd4c5df998dc95fd3b145a77de20a02c6c2c0` on
`feat/0.12-personal-memory-command-admission`. The existing conversations package owns exact human
message selection and command composition; the personal-memory package retains lifecycle and
persistence policy. The workflow input contains only the silo and operation identifiers.

Source preparation now accepts strict Remember, Correct and Forget commands. It reads one selected,
completed human message through current conversation access, limits the source to one non-empty
64-KiB text block, and retains only encrypted coordinates and digests for SQL. Transaction-bound
revalidation checks current access and the selected payload without rejecting unrelated later
conversation entries. Dataset and target lookups stay in the personal-memory package.

New operation admission takes the dataset and fact locks, resolves exact command replay, and calls
the existing workflow engine only when inserting new work. Absurd chooses the task ID; the returned
receipt and operation commit together. The former standalone reservation-only admission method is
removed. Four real PostgreSQL/Absurd tests prove concurrent admission, replay with a new engine and
database client, invalid-receipt rollback, and rollback after operation insertion. They start no
worker and do not prove authenticated product command admission or provider execution.

The complete authenticated command transaction and worker remain unfinished. First-dataset
creation needs the proposed self-only MemoryScopeCollection Create grant; automatic approval
review rejected that permission expansion and its explicit source approval is pending. No grant,
route or production task registration is added by this preparation slice. Existing-dataset paths
must not substitute for the missing authorization design.

The gateway audit also identifies the next protocol bridge: document-list evidence and Cognify must
carry the provider-created input digest and exact saved indexing-operation receipt. The current
dataset-only gateway response cannot prove indexing completion. The client replacement remains a
separate pending approval; admission work does not activate it or add another memory transport.

Local validation passes 591 conversation tests, 45 personal-memory tests, 114 server tests, all three
package lint/type checks, seven personal-memory SQL cases and the server SQL target including the
four actual Absurd cases. The SQL fixture and test processes use UTC. Server build/OpenAPI,
style, Prisma ownership, module growth, workload/domain guards and their negative tests, release
binding and live stack preflight pass. Architecture preflight/post-review and the independent
33-file review pass with no findings. Exact-head CI and live qualification remain separate gates.

## Durable personal memory operations — persistence and integration proof

The operation repository now saves Remember, Correct and Forget command coordinates, encrypted
source references, reserved workflow identity and monotonic provider receipts. Exact replay returns
the original operation after dataset adoption or a fact revision change. Concurrent writers use
the existing transaction helper and dataset → fact → operation lock order.

A new personal dataset can remain Provisioning without a provider UUID. Adoption and the saved
operation step commit together; recall selects only Active datasets with adopted UUIDs. Forget
hides the fact in its admission transaction. PostgreSQL owns fact revision increments, and catalog
completion requires matching durable fact evidence. Names derive from the immutable catalog ID
through the shared gateway format; no second name column or remembered plaintext is stored.

Local proof passes 38 package tests, seven real PostgreSQL repository cases, all 12 workspace SQL
targets, package lint/type checks and the server build. The new SQL authority suite has 23
assertions. Repository cases cover concurrent admission/adoption, exact replay after a new client,
recovery evidence, Forget visibility for Active and Corrected facts, and rollback. Both the
disposable database and test process use UTC, matching CI: local timezone offsets otherwise change
the existing timestamp-without-time-zone authority fixtures. No fixture or authority check was
weakened. Style, Prisma and ownership boundaries, module growth, release binding and fresh-baseline
regeneration pass. Architecture preflight/post-review and independent review of the complete source
overlay pass with no unresolved findings. Draft #876's exact-head CI at
`7c1bd4c5df998dc95fd3b145a77de20a02c6c2c0` passes in run `34725808689`, including database,
KurrentDB, API generation and component checks. Live qualification remains separate.

This is persistence infrastructure. The complete authenticated command transaction must still
compose current authority, dataset/catalog mutations and typed Absurd task admission. Reserved task
identifiers do not prove that a task was admitted. Catalog completion is deliberately unavailable
through the standalone operation UoW until its exact mutation owner is composed. Gateway/client
integration, product routes, permitted recall and live qualification remain unfinished.

## Recover interrupted memory indexing — source implementation

This slice starts directly above #874 at `b7acc1f94e24a41d0c151da252592c36dc613582`.
It extends the disposable Cognee candidate's existing dataset-data and Cognify boundaries so an
indexing operation is identified before dispatch. A bounded document-list receipt binds the exact
raw content and processing metadata. Under the existing dataset lock, first admission compares
that snapshot before saving Started; recovery reads the complete ordered history for the exact
operation. Completed work replays its original receipt. Started, missing or contradictory history
remains recovery-required and cannot start another indexing run.

The repair adds no queue, workflow engine, persistence model or provider activation. It preserves
the candidate's one-worker, one-replica and local-store restriction. Absurd and the OpenCrane
operation owner will save the command; the gateway remains the provider and credential boundary.
Gateway protocol/client integration and the complete Remember, Recall, Correct and Forget journey
remain separate source work.

All 68 local Cognee tests, including the 43 focused candidate tests, and Cognee lint pass. The patch
applier reproduces the declared postimages from the pinned upstream source. Architecture post-review
and independent correctness review pass. Production and candidate qualification each require
their own exact dropped-response evidence; neither accepts the other profile.
Installed-image tests count actual model and embedding requests across lost-response, concurrent and
restarted replay, and reject a changed snapshot before first dispatch.

The first exact-image run on draft #875 (`331f80a2500d8d5e1eac113e5bc33d4ced42a2de`)
passed affected build/test/lint, database authority, KurrentDB and review topology. Both provider jobs
failed. The candidate stopped on its first Add before any indexing-recovery request: external
tokenizer discovery exhausted the connection-test deadline before reaching the synthetic provider.
The reviewed harness repair disables that external discovery while retaining the actual synthetic
model and embedding connection tests. All eight focused harness tests and Cognee lint pass.
The repaired candidate passed exact-image qualification at `320a16caff0fa6511825c396c91c4ce4371fb517`
(run `34724401692`, job `103635957933`), including retained recovery evidence. The separate
production-provider job still failed, so the overall workflow is not green. Candidate proof does
not promote the image or establish testv5 readiness.

## Recover interrupted memory dataset permissions — implementation and validation

The deletion-repair candidate now passes its complete exact-image qualification in #872 at
`c35f6de574cd3282574d897ac428a6dd71eac3bc` (run `34705958601`, candidate job
`103586018265`). The same candidate passes above it in #873 at
`925ecf4b57d06ce1b36daad23ebff31b79e94711` (run `34706149600`, job `103586556227`).
Both workflow runs still fail the separate production-provider contract. Passing the repaired
candidate does not promote its image, enable memory, or qualify testv5.

The next provider repair starts from #873. A dataset can survive interruption before its four
permission grants finish. The existing-name route previously returned that incomplete row without
restoring its grants. The candidate now always enters the existing creation authority and serializes
its grant sequence with the provider's dataset lock. The scope remains one provider worker and
replica, one local SQLite store, and the dedicated gateway service user. The source patch and its
receipt hashes extend the existing image attestation; production configuration stays unchanged.

Qualification injects interruption after the row and after each grant, restarts the provider, then
retries each saved name. It must prove the original identity, four unique owner grants, foreign-owner
isolation and successful public list/add/search/delete operations. All 61 local Cognee tests pass,
including 38 candidate fixture tests and 15 dataset tests. Cognee lint, both exact upstream patch
applications and independent review pass.

Draft #874 publishes this repair at `9c541ddc5e36917bb97f0d7554d851d57aa3ff18`.
Its first exact-image run `34708526857`, candidate job `103593018371`, stops during
source attestation before exercising the permission-recovery cases. The two repaired modules
were absent from the upstream module map, so the verifier correctly rejected their non-null
preimage hashes as declarations of new modules. The correction adds their verified official
1.5.4 hashes to that map. A regression loads the actual candidate declaration and image profile;
it reproduces the failure before the correction. All 16 source-evidence tests and Cognee lint pass
after the correction. The verifier and provider patches are unchanged.
The manifest correction is pushed at `b7acc1f94e24a41d0c151da252592c36dc613582`.
Successor run `34719384285`, candidate job `103622387219`, passes the complete exact-image
qualification, including interrupted permission recovery, deletion recovery, isolation and restart.
The separate production-provider job `103622387188` still fails; the candidate result does not
promote the production image or qualify the product memory journey.

Gateway HTTP handlers, provider operations and the server client are being prepared in parallel.
Automatic approval review rejected deletion of the old client and tests, citing integration risk.
The replacement is being tested and its exact removal proposal prepared; the rejected deletion is
unapplied, and no compatibility or dual protocol is accepted as the finished implementation.

## Personal memory journey — implementation started

This M1 wave starts from draft #872 at `c35f6de574cd3282574d897ac428a6dd71eac3bc`
on `feat/0.12-personal-memory-journey`. The accepted first outcome is an explicit Remember
from an already encrypted user message, followed by separately consented recall in another
conversation. Correct and Forget must also pass before M1 is complete.

The memory adoption preflight passes for implementation. The deletion-repair candidate has now
passed its exact-image suite, as recorded above. Earlier run `34703714519`,
candidate job `103579931845`, passed image build, non-root runtime and source attestation, then
failed in a test adapter before deletion qualification finished. The correction is reviewed and
pushed in #872, with all 53 local tests passing. Successor run `34705105949` passes dataset recovery,
scoped search, document identity, Add recovery and final-reference deletion, then fails in synthetic
process startup. The separate reviewed startup-handshake correction is now pushed at the base above.
The subsequent exact-image run passes the complete suite. Dataset ACL recovery and product
integration still require their own evidence before memory activation.

The detailed protocol handoff found two further recovery boundaries. Cognee currently commits a
dataset before its separate access grants, and an existing-name retry does not restore unfinished
grants. Dataset activation must wait for candidate repair and interruption tests. A lost synchronous
cognify response also lacks correlated completion evidence; it must remain RecoveryRequired until
controlled replay or a provider status receipt is proven. Shared DTOs and provider authentication
can be implemented independently, but neither enables memory writes.

The shared gateway contract and provider authentication foundation are implemented locally. Thirteen
contract tests and sixteen authentication/HTTP tests pass, along with both package type checks,
dependency lint and workload ownership checks. Provider credentials and responses stay within the
new gateway library; it has no app consumer or enabled route yet. Independent source reviews and
architecture post-review pass with no remaining findings. The workload boundary's negative tests
also pass, and all four module-growth candidates have been reviewed for responsibility and cohesion.
Dataset/document adapters, the server client replacement, consent, personal workflow/catalog
adoption and production composition remain the next implementation work.

Implementation owners and dependency order:

1. Settle stable gateway request/response contracts and keep provider authentication and protocol
   handling in a dedicated library composed by `apps/memory-gateway`.
2. Implement gateway-only provider credentials and authenticated dataset/document operations in
   parallel with the server client. Both consume the shared contract; neither saves workflow state.
3. Add personal dataset provisioning, metadata-only fact adoption, and active-document recall
   filtering under the personal-memory domain. The existing Absurd engine owns operation keys,
   retries and saved progress. PostgreSQL receives source coordinates and digests, never fact text.
4. Bind Remember to explicit operation consent and an authorized encrypted source. Compose the
   workflow and recall delivery through the existing conversation owners.
5. Adopt the qualified image/authentication/storage profile, then prove Remember, restart and
   cross-conversation recall before extending the same saved document coordinates to Correct and
   Forget. This source wave does not authorize deployment or testv5 changes.

The server keeps its audience-bound gateway token. Cognee credentials remain in the gateway, and
the frozen personal dataset determines every recall. The gateway performs protocol translation;
it does not gain a database, outbox, scheduler or authority to choose a person's dataset.

## Recover interrupted memory deletion — source reviewed, local checks passed

This independent M1 slice starts directly from draft #871 at
`749b50058f6503653d203b5a7caf98926076cf08`, on `feat/0.12-memory-delete-recovery`.
The remote MCP connection wave remains in its separate worktree. Its personal connection UI has
passed local tests, build and independent review; its runtime SQL acceptance remains blocked on
the earlier specific source approval.

The unpatched Cognee 1.5.4 candidate commits deletion of its Data row before deleting both stored
files. If file cleanup fails, restart loses the information needed to finish. The candidate repair
keeps and locks that row until cleanup succeeds, checks references across both file-location fields,
and rejects paths outside the provider's storage root. Missing files count as completed cleanup.
The candidate image must verify the upstream source, each patch and the resulting source bytes.
One provider-owned local file lock covers ingestion and deletion against the same storage root and
relational store. It prevents concurrent operations from losing a shared file or leaving it behind.
Cancellation and process death must release the lock, and a child task cannot inherit its parent's
ownership. The candidate remains limited to Linux, local file storage and its default SQLite store.

Architecture preflight permits this candidate-only implementation. The existing image qualification
must also prove interruption before either file removal, interruption before the final commit,
restart using the same public document coordinate, shared-reference retention, path containment,
and concurrent shared-file delete/delete and delete/add. The 15 focused source-verification tests
pass: the receipt preserves official preimages, records new modules explicitly, verifies the patch
and running source, rejects unrelated source drift, and retains machine-readable evidence when a
repair declaration fails. The complete local Cognee test and lint run passes all 45 tests, shell syntax
and Python compilation. Architecture preflight/post-review and independent source, build and harness
reviews pass. All four patches were independently reconstructed and compiled against the official
source. Style, Prisma ownership and module-growth checks have no errors. Source whitespace checks pass; the patch artifacts contain only required blank context markers. Exact-image CI still
must run every interruption, restart and concurrency case before provider qualification is complete.
The memory gateway gains no file paths,
storage access or second deletion mechanism. Production image pins, charts and memory mutations
remain unchanged. No live provider, credentials, cluster or testv5 data are touched.

Draft #872 publishes the candidate source. Its first exact-image run (`34703119458`) stopped
during image construction: the upstream image's non-root user could not create the repair-evidence
directory under `/opt`. The candidate Dockerfile now uses root only to install the source repairs
and evidence, then returns to the upstream `cognee` user before the existing extension setup.
The next exact-image run (`34703714519`, job `103579931845`) builds successfully, passes the
non-root runtime smoke check and reports no source-attestation mismatches. It then stops in the
path-safety fixture because its old adapter double cannot call the repaired provider's private
cleanup helper. The fixture now inherits the installed adapter's helper chain and replaces only
database construction and the reference-count query. Its seven focused tests pass, including a
regression for that inherited call. All provider containment assertions remain required;
deletion qualification still awaits a successful successor CI run.

The candidate harness now also requires same-name dataset identity across repeated and concurrent
creation, recovery of an unread create response through the saved name and owner, and the same
coordinates after the existing provider restart. All 53 local Cognee tests and lint pass. These
checks cover successful creation and response loss, not interruption between the provider's dataset
commit and separate access grants. That partial-grant recovery gap remains a required provider
repair before product provisioning; a lost synchronous cognify response also remains unresolved
without correlated completion evidence. The next personal-memory source wave starts separately
with stable gateway DTOs and gateway-only provider authentication.

At `36e1717bbc0bd395c474b2e1534958630f34e020`, exact-image run `34705105949`, candidate job
`103583745894`, passes dataset identity/replay/response-loss and restart checks, scoped search,
document identity and add recovery, and first/last-reference deletion. It then times out waiting
two seconds for a synthetic lock-holder process to import Cognee and signal acquisition. The fixture
now waits up to 30 seconds for an explicit post-import readiness signal, then retains the separate
two-second acquisition deadline and termination/reacquisition assertions. This changes the process
test's startup allowance, not the provider lock or its deadline; full interrupted-deletion and
concurrency qualification still require a successful successor run.

## MCP readiness CI repair — 2026-09-12

The first exact-head run for draft #871 found missing readiness data in existing conversation test
fixtures and one changed Linux component reference. The repair gives the unit fixture the current
installation reader, proves that a missing ready installation denies dispatch, and seeds the SQL
fixture with an explicitly credentialless server and its execution Principal's installation.
Production source is unchanged. Independent review accepts the two fixture changes and the exact
Linux Removing-state capture, including the corrected “No credential required” label.

Validation passes all 114 application tests, application type checks, 44 real PostgreSQL application
cases and the three SQL authority scripts. The disposable PostgreSQL database and Node test process
both use UTC, matching CI; this prevents local time-zone offsets from changing timestamp-without-time-zone
authority evidence. Style and Prisma ownership checks have no errors. The latest read confirms that
exact-head CI passes its selected jobs, including real Kurrent recovery and Linux visuals. No testv5 or live provider
changes are included.

## Explicit MCP connection readiness — source reviewed, CI passed

Draft [#871](https://github.com/elewa-git/opencrane/pull/871) publishes T1 on
`feat/0.12-mcp-credential-readiness`, based directly on memory correction
[#870](https://github.com/elewa-git/opencrane/pull/870) at
`a415684ae98758e0e52970ea42ffabeebeaae66e`. The implemented prerequisite replaces
server-type-derived readiness with an explicit credential requirement and repeated checks of the
execution Principal's installation. This slice stores no credentials and activates no remote connection.

The schema and public contracts distinguish credentialless, Principal-owned and shared credentials.
Uploaded OCI servers must be credentialless; an installation requiring credentials remains
unavailable. The UI says “No credential required” only for that explicit state. Unused work loses
eligibility when its exact installation, pinned tool revision or published server is unavailable.
The final installation lock serializes uninstall with the ToolInvocation claim in one transaction;
already-dispatched or uncertain work retains its evidence. Task creation now respects the baseline's
Preparing-to-Ready transition before queueing work.

Architecture preflight and post-review, component review and independent source review pass.
Validation includes 179 MCP, 544 conversation, 122 contract and 2 API tests; frontend core (14),
MCP adapter (11), gateway (15) and tools (8) tests; their lint/type checks; baseline preservation,
release binding, dependency and authority boundaries. Five tests against a fresh disposable PostgreSQL
baseline prove both observed uninstall/claim orders, wrong coordinates and server lifecycle denial,
and credentialless-schema/OCI constraints. The database is stopped and preserved. Style has zero
errors and four inherited warnings outside the changed lines; module growth has zero errors and two
reviewed ownership candidates. The changed Darwin component reference has independent acceptance.
Linux visual qualification remains a CI gate. Final server and production UI builds pass after the
last reviewed gateway and task-transition corrections. All 183 Storybook behavior checks pass.

The PDF repair in [#869](https://github.com/elewa-git/opencrane/pull/869) is pushed at
`8c534445f93dcc7168c06a6f8d1dbec4f459bcde`. Its exact-head CI run `34689057317` is green,
including affected build/test/lint, real Kurrent attachment lost-response recovery, database authority,
generated API, Linux Storybook and all selected image checks. Memory correction #870 fixes the candidate fixture's exact
SQLAlchemy adapter class name and is pushed directly above it. Its ordinary affected checks pass;
the current Cognee 1.2.1 provider still fails its deletion gate and the 1.5.4 candidate qualification
also fails in run `34689058826`. The candidate failure is under diagnosis. Neither result qualifies a usable memory product.

Standard remote MCP activation follows this prerequisite through MCP-owned credential custody,
connection-specific discovery and server-owned calls using the existing Absurd workflow. Remote and
hosted provider qualification, deployment and testv5 data remain separate.

## Ready conversation file access — 2026-09-12

The F1 file-access source slice is stacked directly above #867 at
`a6337511183042952fce67b25608e8473b553eb3` on
`feat/0.12-conversation-asset-downloads`. It connects the existing Files panel's Open action to
the authenticated Ready-asset content reader. The reusable asset card gains matching loading and
error states in Storybook; the production transcript does not yet mount that card.
The server's projected disposition remains authoritative: PDF, MP3 and PNG may preview; supported
download-only files cannot become previews because their returned bytes claim another media type.

Implementation uses a selected-conversation content store, a small file-action coordinator and the
existing platform bridge. Pending reads have per-file loading and safe retry feedback. Switching
conversations, losing access or destroying the workspace cancels pending browser reservations and
discards late results. Preview reserves its blank tab during the user action, before awaiting bytes;
the platform owns that tab, download anchors and bounded object-URL cleanup. Blob content is never
retained in application state.

Architecture and component preflight pass. The frozen source passes 106 focused tests across the
platform, asset state, asset presentation and workspace packages; their lint/type checks; all 177
Storybook behavior checks; three macOS visual checks; and the production UI build. The three new
visual references have independent inspection. Style and Prisma boundaries pass with no errors or
warnings; module growth has no errors and identifies the two focused state owners for review.
Independent source review, architecture post-review and component post-review pass with no
outstanding findings. Linux CI passes. This slice changes no backend route, upload contract,
model request, credential path or runtime-question behavior. Scanned document input and generated
file production remain separate F1 slices. Testv5 and live file access remain unqualified.

Draft [#868](https://github.com/elewa-git/opencrane/pull/868) publishes this source at
`158962f9cd94b4f6886960e7eeaabe06c4fdf595`. Exact-head CI run `34681268050` passes affected
build/test/lint, database authority, real Kurrent, stack, Storybook Linux visuals and the UI image
build. The three new Linux references came from independently inspected CI captures; existing
images and comparison tolerances are unchanged.

### PDF-informed answers — source complete, CI pending

F1a starts from that exact #868 head on `feat/0.12-conversation-pdf-input`. It connects the
existing PDF upload and preprocessing path to participant message admission and server-owned
model input. The component preflight reuses the attachment tray and file card, adds a narrow PDF
picker, and requires an exact artifact/revision/message join before showing file actions.

Architecture and component preflight pass. Source implementation now binds attachments atomically,
including empty-set retries, and reads bounded derived content outside write transactions. The accepted command keeps its text,
attachment set and retry key after an uncertain response. Only completed, lineage-checked PDF text
may enter the model as untrusted user content. Saved model input and the original remaining
allowance retain their current restart guarantees. Generated file production remains the next F1
slice. Attachment-only messages require an authenticated encrypted empty-text payload. The fresh-install
baseline permits zero ciphertext bytes while preserving nonce, tag, ownership, uniqueness and
immutability checks; seven new PostgreSQL checks pass on a disposable database. Independent source,
architecture and component post-review pass. No live provider call, deployment or testv5 change is
part of this source work.

The implementation now passes 543 conversation tests, 113 app tests, focused PDF preparation and
asset tests, six frontend package test/lint targets, the initial server/UI builds, generated API checks and the
Prisma, workflow, domain and app-composition boundaries. A disposable PostgreSQL proof confirms
one author wins a concurrent message UUID and retries cannot replace an originally empty attachment
set. Backend architecture and independent message-admission source review pass. Acceptance still
requires the real Kurrent lost-response/conflicting-entry proof and Linux visual qualification. The
final Storybook behavior run passes all 183 checks after the corrected geometry guards and PDF
desktop/narrow fixture coverage.
Visual review found and corrected Send clipping in two 390px composer states. The responsive
footer and its bounds regression pass independent review. Final desktop and narrow PDF captures
show the named bound attachment and the next selected PDF with usable actions. All three macOS
visual checks pass against six new and sixteen changed independently accepted references.
Independent frontend review caught implicit attachment selection and uncertain-send display
bugs. The reviewed corrections keep an explicit selected set, allow deselection without deletion,
count all selected files, and visibly lock the draft and attachments while an uncertain message is
retried. Focused asset-state tests (47), workspace-state tests (85), workspace-feature tests (57),
asset-feature tests (14), and composer tests (8) pass with their relevant type checks. Runtime asset
metadata now goes through a validator beside its model. Independent source review clears the
material findings, and the final macOS captures have independent acceptance. The final UI production build passes
after fixing two request-serialization type errors: Stop supplies an empty attachment list, and
message send copies the domain's readonly list for the generated client. All 16 adapter tests and
its lint target pass. Style and module-growth checks have zero errors.

The real PostgreSQL/Kurrent recovery test is implemented in the existing conversation integration
target and history-store CI job. Local typecheck and collection pass, with real service cases
explicitly skipped because no local Kurrent endpoint is configured. An explicitly unqualified draft
can run that CI proof; passing it is required before calling the slice ready. Draft
[#869](https://github.com/elewa-git/opencrane/pull/869) publishes the slice directly above #868,
with real-store CI, Linux visuals and live qualification still pending.

The first draft CI run exposed an attachment authorization wiring defect before either new real-store
recovery case reached its intended assertion: the attachment repository passed Conversation Use to
the authorization catalogue's Read-only filter after message admission had already recorded Use in
the same transaction. The local correction removes that duplicate check and limits the shared read
helper to Read at compile time. Independent source review, 43 asset tests, 543 conversation tests
and both package lint targets pass; a new exact-head real-store run remains required. Independent
visual review accepts twenty Linux captures. Two PDF filename captures lack Chinese glyphs and
remain rejected until the bounded CI font installation produces new evidence. The filename fixture
and screenshot tolerances are unchanged. No live PDF answer or testv5 qualification is claimed.

Exact-head run `34687912995` on `f3f4f35a254a3bd1d9423f677a7e24904f78c9be` passes the real
Kurrent attachment recovery cases, database authority and generated API checks. Its only visual
failures are the two deliberately absent PDF shell references. The new desktop and narrow captures
from artifact `10296043961` render the Chinese filename correctly and pass independent inspection;
they are now accepted without changing fixtures or tolerances. One asset-store unit case assumed the
initial list was loaded before testing byte-upload retry. It now waits for that existing precondition;
all 47 asset-state tests pass, with the original retry assertions unchanged. A new CI run must
confirm these test/reference corrections; production source is unchanged.


## Execution checkpoint — 2026-09-11

Draft #858 is fully green at `3cb899d68c851bfb0073c42933fc77fba3fe0e17`:
CI run `34578065587` includes the real KurrentDB lost-response recovery case, database authority,
build/test/lint, API generation, all 169 Storybook behavior tests, Linux visual checks, and server/UI
image builds. The complete PR stack check passes. This pull-request workflow does not publish images
or deploy testv5.

Draft [#862](https://github.com/elewa-git/opencrane/pull/862) starts directly from that exact commit
on `feat/0.12-conversation-work-cancellation`. Its first published commit is
`e6765da605a9235d1be7f285ac332809e7845af9`. Source implementation covers the participant Stop
message, server-selected saved target, Absurd cleanup, private Kurrent receipt and personal Stop
control. Authorized Kurrent selection binds every delivery to the same target or no-target outcome
before SQL rechecks authority and admits cancellation. Final output and cancellation compete on the
same turn-stream revision. A committed answer
remains successful; cancellation closes pending approvals while preserving dispatched or uncertain
effects. Recovery resumes the saved task without another model request or a fresh allowance.

The user approved this source implementation and tests. Local validation passes: 1,098 tests and
seven package lint/type checks across the server, conversations, runs, IAM, history, API and contracts;
155 frontend tests and their type checks; 15 SQL tests; 174 Storybook behavior/accessibility tests;
and all three macOS visual checks. Server and production UI builds, API generation, Prisma,
style, module-growth and release-baseline checks pass. The new SQL case proves an active participant
with Conversation Use still cannot select another requester's turn. The Kurrent integration target
collects successfully with three local tests passed and twelve service-dependent cases skipped;
CI run `34591425003` passes affected build/test/lint, all database authority suites and both image
smokes. Both new Target/NoTarget selection races pass against real KurrentDB. One older stale-pointer
fixture reused the wrong command digest; the reviewed correction recomputes it for that request.
The generated website API reference is now synced. All 12 unique Linux renders from that exact
commit (artifact `10195948833`) passed independent visual review and were copied byte-for-byte into
the references. Final CI run `34592580306` is fully green on
`6536ac318d375685a2771c4156b9954a7971e2ce`: affected build/test/lint for 79 projects, all database
authority suites, real Kurrent proofs, generated API, all 174 Storybook tests, three Linux visual
checks and seven image builds pass. This pull-request run does not publish images. Production code
is unchanged by the CI corrections; the live PR stack also passes.

Architecture and independent reviews cover the final source; all raised findings are resolved.
Database tests use an isolated local PostgreSQL instance, not testv5. Personal controls are the first UI journey; controls
for other participants remain an unresolved actor-policy decision. Source completion does not
qualify a live Stop journey or authorize deployment.

Company-tool approval implementation and remote MCP activation retain their recorded approval
blocks. The testv5 repair still preserves all current data and awaits deployment approval. Its
strengthened wrapper passed independent review and a fresh read-only inspection of image, baseline
and volume coordinates. No install, database reset or test-data deletion occurred.

### Next slice: qualify the pinned memory provider

The memory slice starts directly above #862 at `6536ac318d375685a2771c4156b9954a7971e2ce` on
`feat/0.12-memory-provider-contract`. Architecture preflight passes for test-only qualification under
the existing Cognee app and CI workflow. No application adapter, memory write path or deployment
configuration is changed in this slice.

The source audit found that Cognee 1.2.1 CHUNKS retrieval does not apply the requested dataset when
backend access control is disabled. The current chart disables that switch. The inspected source
also separates chunk and document identity and provides no operation-idempotent HTTP Add contract.
These findings require proof against the exact image; a matching version label alone is insufficient.
The inspected last-reference deletion removes the processed source but can retain the original
upload. Official Cognee 1.5.4 contains a fix for that ordinary case; its different ingestion/schema
and path handling require separate qualification before selecting it as a replacement.

The dedicated uncached `cognee:memory-contract` target runs two disposable provider configurations,
synthetic datasets and a deterministic local model/embedding stub on an internal Docker network.
It must prove dataset isolation and useful recall, exact document/source identity, recovery after a
committed response is lost, restart/index convergence and deletion boundaries. Selected CI cannot
skip missing Docker or missing proof. The existing image-smoke selection owns the job condition and
normal publication waits for its result. Implementation and provider qualification are in progress.
Draft [#863](https://github.com/elewa-git/opencrane/pull/863) records the reviewed source at
`5fdbd56e7b8260054da296372915111720275182`. Its first image run `34597141363` built successfully
but stopped before semantic tests: the container label says `1.2.1`, while the loaded package reports
`1.2.1-local`. Attestation now retains all inspected module hashes and source snapshots before
rejecting mismatches. Expected hashes remain unchanged until that exact source is reviewed.
The second image run `34597761277` captured all 14 named modules: every source byte and expected
hash matches the reviewed 1.2.1 source. The only mismatch is the version suffix. Upstream's version
reader appends `-local` when reading its source checkout, so the fixture now requires the observed
exact value `1.2.1-local`. No source hash or semantic requirement is relaxed; the next run can reach
the provider behavior tests.
Run `34598301881` passed source attestation and the ACL-disabled negative control, reproducing
cross-dataset retrieval. The positive case stopped at HTTP 401: Cognee requires authentication when
backend access control is enabled. The harness now qualifies that candidate with an explicit
synthetic test-account login, repeated after restart, without retaining tokens in evidence. This
does not change chart defaults, gateway authentication or production credentials. Positive
isolation, recovery and deletion remain unproved until that authenticated case runs.
Run `34599650427` passed attestation, synthetic login, dataset creation and ingestion, then exposed
a harness parsing error: authenticated CHUNKS search returns a dataset envelope. The fixture now
requires exactly the requested dataset envelope in that mode and keeps the ACL-disabled flat
response separate. Eight fast provider tests cover authentication, proxy forwarding and malformed
or foreign-dataset search responses.
The exact-image run `34600864382` at `5902fb82109ebba2b357dba44bb42b787b9e0dd9` then passed
authenticated dataset isolation, useful multi-chunk recall, document identity, committed-response
loss, restart recovery and shared-reference preservation. Final-reference deletion failed: API,
raw-route, graph and vector visibility disappeared, but the original uploaded file remained under
the provider's data root. The retained artifact records this as a provider guarantee failure, not
a harness error. The current image does not qualify for Forget; keep the failing assertion and
publication gate. A separate whole-provider candidate must prove erasure, local path ownership and
recovery after an interrupted deletion before memory mutation can be enabled.
Personal Remember, Recall, Correct and Forget remain unavailable until this evidence and their
subsequent product slices are complete. Local container VMs are not started for this work.

### Candidate follow-up: fresh Cognee 1.5.4 qualification

Draft [#867](https://github.com/elewa-git/opencrane/pull/867) starts directly above #863 at
`b8f7d7ac902583b6a0a4e348c3189188ecf28149` on
`feat/0.12-memory-candidate-qualification`. Architecture preflight permits a disposable image and
contract under the existing Cognee test tree. The production Dockerfile, chart, release manifest
and failing 1.2.1 publication gate stay unchanged.

The official 1.5.4 source fixes ordinary original-upload deletion, but changes document identity to
dataset-scoped rows, uses a newer native database extension and still has a gap when file cleanup
fails after the relational deletion commits. Qualification must check the whole provider on fresh
storage: exact source/image/native-extension pins, non-root offline startup, dataset and document
identity, useful recall, lost-response and restart recovery, shared files, local path ownership,
and interrupted deletion. Every failed proof stays visible; a candidate pass never publishes an
image or enables personal memory by itself.

The bounded source slice is implemented and independently reviewed. Local Cognee test/lint passes
with 23 Python tests, image contracts and a regression rejecting a smoke run with no execution
receipt. All 24 affected-deployable tests and the relevant ownership, style, Prisma, module-growth
and release checks pass.

The first exact-image run, `34608702447` at `5123f591bfecc25fe355e693b78546b985f67480`,
passed offline image/native-store checks and all 47 installed source hashes. The fixture then
stopped on a response-field mismatch: Cognee's HTTP dataset records use `datasetId`, while the
fixture read the internal Python field name `dataset_id`. This did not prove a foreign listing.
The bounded correction reads the exact HTTP field and keeps dataset ownership strict in both
control and authenticated modes. Search, authenticated recovery and deletion were not reached;
the corrected candidate then required another exact-image run.

The corrected run `34678289718` at `d1d783e482276ef5c8924117b611fb554c69d14c`
passes image/native-store checks, all 47 source hashes, the ACL-disabled negative control,
authenticated dataset isolation, identity and committed-response/restart recovery. It stops at
identical content in a second dataset: that dataset has its own byte-proven document row, but the
CHUNKS response does not establish the required useful retrieval for that document. The returned
chunk/document coordinates were not retained. Source and log follow-up show that session
preparation replaced the requested query with the synthetic model's `query_to_answer`; a ranked
top-20 response to that query cannot prove complete document association. The next proof must
separate graph association from useful retrieval and retain only safe chunk/document coordinates.
This result does not establish lost chunks. Deletion, path containment and interrupted-deletion
checks were not reached. The
candidate remains unqualified; no production image or memory availability changes.

The diagnostic follow-up records graph document/chunk association separately from the ordered
CHUNKS coordinates, with duplicate results preserved and distinct counts reported. The evidence
is saved before the existing two-chunk assertion, so a repeat failure can be classified without
retaining source text or relaxing that gate. Fast tests cover malformed coordinates, exact target
selection, duplicate preservation and evidence retention on assertion failure. Cognee test/lint
passes and independent source review passes. Exact-head CI run `34681268225` at
`a6337511183042952fce67b25608e8473b553eb3` now preserves the failed proof: the second dataset's
graph contains 12 chunks for its distinct document, while its scoped CHUNKS response returns 20
coordinates and none for that document. Follow-up confirms the fixture query was replaced by the
synthetic model's literal `query_to_answer` during automatic feedback preparation. That ranked
response does not prove missing vectors or a provider retrieval defect. The candidate harness now
disables that query rewriting so its fixed synthetic query reaches vector search unchanged. Every
useful-retrieval, isolation, restart and deletion assertion remains unchanged; the corrected harness
still needs exact-image CI. The candidate remains unqualified; deletion checks have not been reached.

The candidate keeps a separate disposable lifecycle because its non-root storage, evidence volume
and additional restart differ from 1.2.1; API, stub, proxy, attestation and summary helpers remain
shared. Remove the obsolete lifecycle when a qualified production replacement is selected.
Before activation, complete the wider provider matrix: concurrent delete/add, interruptions before
relational commit and between graph and relational cleanup, exact schema/native-store recovery,
duplicate-chunk checks and explicit removal of both stored file locations.

## Delivery priorities — 2026-09-10

The user selected this order. Each track delivers a useful journey through the existing owners;
published applications and code work are deferred. Narrow prerequisites, such as a connection setup
API or the approval needed for one action, land with the first capability that needs them. Full
administration and action recovery retain their places below.

An active execution goal now covers these ten tracks. Continue through reviewed, coherent slices
with cheaper parallel agents, keeping source/CI evidence separate from live qualification. The
visible approval slice is published in draft #857 above #856 at
`b9b362f0ed7ceeef6212f1c4ef1c799e69243913`. The standard MCP contract, personal approval wait,
memory provider coordinates, selected-conversation request discovery, frozen action disclosure,
durable approval notification and conversation approval card have reviewed source changes.
The next T1 slice now publishes durable tool-result facts in personal and company-child
conversation history and renders them through the existing transcript. Remote connection activation and credential use still
await the recorded approval decisions; neither source tests nor a healthy MCP process prove a real
connected journey. The testv5 repair is prepared separately and preserves current data.

The tool-result source is published in draft [#858](https://github.com/elewa-git/opencrane/pull/858)
on `feat/0.12-conversation-tool-results`, based directly on
#857 at `5a4e3bcf5d1ee2e2b1069984854866681ffd9d2c`. Architecture preflight/post-review,
component review and mandatory independent source review pass.
Independent backend and frontend lanes reuse the current IAM result reader, atomic history receipt
and transcript status-line component. The server publishes only a terminal tool fact after encrypted
result custody and before reserving its final model call; history failure must leave that call
unspent. No new API, schema, scheduler or credential path is required. The transcript coalesces
each invocation's latest phase, preserves message actions and clears retained results on access loss.
This producer emits terminal facts; requested/running production events and complete controls remain U1.

Local validation passes: 494 conversation, 245 IAM and 28 history tests; six combined approval/result
and final-answer recovery cases; 13 app composition tests; 34 frontend feature and 65 state tests.
Backend and frontend lint/type checks, server and production UI builds, Storybook build, style,
Prisma, dependency and workload composition checks pass. Style reports 15 production files with
zero errors or warnings. Module growth passes; independent review confirms that the three-line
turn-dependency addition does not introduce another responsibility. All 32 Storybook suites and 169
interaction/accessibility tests and all three local visual checks pass. Six new macOS references
have independent visual acceptance; existing references and comparison tolerances are unchanged.
Workflow, authorization, release and agent-domain guards and the workload/domain negative tests
also pass. Initial Linux CI run `34576967664` on `c07aeeeb9148ea44167b1efa7fd0b721b8d4e29d`
passes database authority, generated API, all 169 Storybook behavior tests and both viewport checks.
Its visual comparison required only the six new Linux references. The renders from artifact
`10190184981` passed independent visual review and are now copied byte-for-byte into the Linux
references, with no changes to existing images or comparison tolerances.
The new Kurrent suite initially failed during import because the IAM barrel loaded an ungenerated
Prisma enum. A reviewed test-only mock supplies the two delivery outcome constants; the publisher,
real Kurrent client, atomic append and recovery remain unmocked. Local import/collection passes,
with six live cases skipped because no local Kurrent endpoint was configured. The successor exact-head
CI run recorded above now passes the real-Kurrent proof and full completion. Testv5, real provider and hosted MCP qualification
remain separate gates.

| Priority | Track | Completion means | Current next step |
| --- | --- | --- | --- |
| 1 | T1 — real tool retrieval | A permitted real record reaches an answer in personal and company-child chats; remote MCP connections and hosted MCP execution have qualified journeys. Results survive reload and restart without repeated dispatch. | IN PROGRESS: company and personal tool-selection APIs and participant terminal-result history are implemented. Personal selection passes real PostgreSQL authority, concurrency and recovery checks. Standard remote activation/discovery/calls are implemented in sibling #886, whose database-authority gate still fails. The joined hosted journey and real integration qualification remain. |
| 2 | T2 — approved external actions | A person reviews an exact action and arguments; one approval permits that effect once. Denial, expiry, changed arguments and revoked authority prevent it. | IN PROGRESS: personal approval, expiry, durable resume and visible decision controls are implemented in draft #857. Company approver/connection binding and real action qualification remain. |
| 3 | M1 — long-term memory | Explicit remember, cross-conversation recall, correction and forget work with consent and isolated datasets. | IN PROGRESS: durable persistence, Absurd admission and catalog completion pass CI in #876–#878. The reviewed candidate shared-file repair passes all 31 image-qualification cases in #881. The production provider is still unqualified. Authenticated composition, gateway/client wiring and product Remember, recall, Correct and Forget remain unfinished. |
| 4 | U1 — visible work controls | People can follow waiting, running and terminal work, make supported decisions and cancel eligible work after refresh. | IN PROGRESS: requester-only personal Stop and durable cleanup pass review and CI in draft #862. Requested/running history producers pass source validation and independent review above #885; the existing transcript and status components are reused. Live qualification and other-participant controls remain separate. |
| 5 | U2 — rich interaction | Durable choices, free text, structured results and A2UI remain usable and accessible after refresh. | PAUSED: runtime-question source work awaits its separate explicit approval; partial implementation is not validated delivery. Structured results and A2UI remain. |
| 6 | F1 — documents and generated files | A scanned document can inform an answer, and a generated file remains downloadable by its authorized audience. | IN PROGRESS: Ready-file access and PDF-informed answers pass CI in #868–#869. Generated CSV production, encrypted capture, scanning and answer-link recovery are implemented in #879; all four combined recovery cases pass again in #880. The pending message-link SQL guard and governed hosted execution through authorized download remain to qualify. |
| 7 | D1 — autonomous delegation | A bounded child works with explicit context and narrower authority, then returns one durable result. | Follow [#845](https://github.com/elewa-git/opencrane/issues/845): root budgets, depth/fan-out, cancellation and result brokering. |
| 8 | S1 — scheduled work | A reviewed routine fires under current authority with explicit overlap, retry and missed-run policy. | Follow [#848](https://github.com/elewa-git/opencrane/issues/848) through Absurd and existing admission. |
| 9 | A2 — complete administration | Operators configure agents, connections, models, permissions and budgets, and inspect effective access and actual usage. | Complete and qualify connection activation, agent/tool/model settings, effective permissions, budgets, actual usage/cost and audit screens over the existing protected owners. |
| 10 | T3 — action recovery | People and operators can reconcile uncertain effects, inspect cancellation races and perform supported safe retries. | Add provider-specific reconciliation and repair controls over durable invocation evidence. |

Every earlier track includes its required current-authority checks, bounded retries, lease/generation
fencing and honest failure state. Priority 10 is the complete recovery experience; it is not a reason
to defer duplicate-effect prevention. [#844](https://github.com/elewa-git/opencrane/issues/844) spans
retrieval, approval, controls and recovery; its full acceptance closes only when those slices pass.
The [delivery plan](docs/design/mvp-delivery-plan.md) records owners and acceptance for each slice.

### First execution slice: company tool selection

The generated-file CI proof exposed a T1 integration gap: discovered MCP names flow unchanged
into model declarations, whose accepted characters are narrower. The owned CSV producer is being
renamed consistently, but remote MCPs can still advertise names the model cannot accept. A
separate architecture preflight has approved the server's name mapping through the existing frozen
tool snapshot and revision-bound dispatch. It must handle invalid characters and collisions and
preserve exact recovery; a test-only alias does not solve this requirement.

Implemented in draft [#850](https://github.com/elewa-git/opencrane/pull/850) on
`feat/0.12-real-tool-retrieval`, directly above
[#849](https://github.com/elewa-git/opencrane/pull/849), with immutable review base
`b4f275b3f090e9387a1b0de658968700c0b7ad04`. Reuse the earlier company-tools implementation and
adapt it to #843's capability folders; do not reopen its obsolete flattened implementation.
Architecture preflight passes for the existing agent-services, revision and execution-evidence owners.

An administrator reads and replaces the assistant's exact tool selection through the API. One
transaction publishes an immutable successor revision and its service-owned grants, with current
Administer/Assign checks and a comparison against the expected active revision. Tool edits preserve
the saved model budget. The initial two-call default supported one tool result and a final answer;
the 22 September follow-up changes new company assistants to eight tool steps and a final answer.
Dispatch continues to use the company identity; a person's private permissions
or credentials cannot substitute for it.

Source work can proceed independently of live setup. Credential activation is absent from the current
MCP installation contract; an installed or SharedKey-labelled server is not proof of a working
connection. T1 remains open until authorized connection custody/activation, a dedicated read-only
integration and durable participant result evidence are proven. Full work controls remain priority 4.
No integration or live cluster state has been inspected in this execution slice.

Validation on this slice: 127 agent-services, 65 personal-configuration, 113 execution-inputs,
95 contracts and 30 dispatch tests pass, plus five real PostgreSQL tests on the exact fresh baseline.
The disposable database was stopped after qualification. Backend/contracts type checks and server
build pass; generated API contracts and website schema are synchronized. Architecture preflight,
architecture post-review and independent source review pass. Prisma, authorization, workflow,
workload composition, domain, dependency, release, style and module-growth checks pass.
The website build passes, including the generated API pages. Commit `376380280` is pushed and
reviewable in draft #850. CI and testv5/live acceptance remain separate evidence. The next source
slice owns connection activation and its execution binding.


### Parallel execution wave — 2026-09-10

The user requested cheaper subagents and concurrent execution wherever the work is independent.
Use Luna for bounded implementation, source audits and focused checks, and Sol for the connection
trust-boundary investigation. The coordinator owns shared contracts, architecture decisions,
integration and exact-head review. Keep one writer per source area and preserve the ten-priority
acceptance order; preparatory work on a later capability does not mark an earlier journey complete.

The next wave starts above #850 at immutable base `9d6daa7eb6c63231005250d5637cc05e73ca7972`.

| Lane | Independent work | Integration boundary |
| --- | --- | --- |
| Connection custody and activation | Trace the existing credential owner and executor resolution; define the smallest protected activation/binding slice and its denial tests. | Architecture preflight before changing credential, schema or execution authority. Secrets stay out of chat, workflow input and the Pod. |
| Durable tool progress | Reuse the unpublished personal tool-progress work under current capability folders; preserve authorization before phase-only reads. | Shared contracts settle before UI adaptation. Component-manager pre/post and independent review remain required. Personal activity is not company participant history. |
| Memory preparation | Verify pinned gateway dataset, recall/deletion identity and recoverable correction; produce a source-grounded M1 handoff. | Read-only preparation while retrieval implements. No memory writes until custody, consent and recovery are proven. |

The coordinator also traces the existing conversation history writer for company-visible tool
receipts. Reuse saved invocation/result identity and the current history/workflow boundaries; do not
create another event queue or treat a progress projection as canonical conversation history.

The history trace confirms that `ToolCallLogEntry` already represents safe tool phases and artifact
references, and `BoundConversationWriter` already prepares a saved, idempotent append intent.
The current turn authority reserves one exact final-output position. Intermediate tool logs therefore
need their own saved append intents and ordering within the existing turn/workflow owner; appending
from a transaction callback without those coordinates would break restart recovery. The personal
activity phase projection can land independently while this canonical receipt work is designed.

The personal activity slice is implemented in draft [#851](https://github.com/elewa-git/opencrane/pull/851)
on `feat/0.12-personal-tool-activity`, directly above #850. Recent work now shows its latest tool as
queued, running, result received or needing attention,
separately from the overall run state. Owner and current Read authorization precede a phase-only
lookup in the same transaction. An unknown state or failed lookup stays an error; it cannot become
an empty activity result. A tool result does not produce an answer link before the completed answer
is loaded and readable. Refresh remains a status read. This does not complete company participant
history, connection activation or full visible work controls.

Architecture preflight/post-review, component-manager pre/post and independent review pass. Focused
contracts, IAM, execution-run, browser state, activity and workspace tests and lint pass. Server and
UI production builds pass; the UI build needed an unsandboxed retry after local process failures.
Generated contracts and website OpenAPI are synchronized, and the website build passes. Storybook
build and 32 suites / 158 behavior tests pass. Prisma, authorization, workflow, dependency, release,
style and module-growth checks pass. The independent reviewer noted the bounded cost of up to 50
progress reads per list, with no demonstrated regression. Both new desktop and narrow activity
stories have inspected Darwin screenshots and passing scoped comparisons. Linux CI run
`34454953777` rendered source `0925e7cd4`; only the two missing new baselines failed. The exact
images from `storybook-visual-evidence-1` were inspected and added, without changing older baselines.
CI run `34455745285` passes on committed source `e4901da0a4cd23cb71a0b0dd303408b39563d823`,
including the Linux images. The published review chain is #831 → #843 → #849 → #850 → #851;
live stack integrity passes. Testv5/live qualification stays a separate gate.



The connection audit confirms that the existing OCI companion accepts only a lease, invocation ID,
tool name, frozen input schema and arguments. Uploaded MCP code has neither provider credentials nor outbound provider
egress. The per-person install labels are not credential custody, and company execution does not
consult them. A label-only activation command is not a deliverable.

The user clarified that the proposed server path must support standard MCP connectivity.
The next retrieval slice must connect a configured remote MCP endpoint, discover its tools and call
permitted tools through the standard protocol with server-held connection credentials. It must not
require each provider to implement a proprietary operation-plan extension. Remote MCP connections
and uploaded MCP executables have different execution boundaries: uploaded code remains isolated,
and remote credentials never enter the ConversationComputer Pod. The remote endpoint, connection
owner and generation are bound to the admitted invocation and rechecked before dispatch. Personal
credentials cannot satisfy company execution. Absurd continues to own durable progression and
uncertain outcomes; no new scheduler, queue or broker is introduced. Exact transport/authentication
support is pinned to MCP 2026-07-28. The current protocol slice moves pure wire validation into
`contracts/src/mcp/protocol`, removes the executor-only protocol package and duplicate probe parser,
and preserves the existing socket and authority owners. It adds required request metadata and
headers, bounded JSON/SSE responses, tool pagination and durable structured results. Connection
activation and real provider qualification still follow this shared contract repair.

The protocol slice passes 122 contracts, 22 companion, 46 remote probe and 152 MCP domain tests,
with their TypeScript lint targets. Server, MCP executor and UI production builds pass. Dependency,
Prisma, workflow, authorization, workload ownership/composition, agent-domain, release, style and
module-growth checks pass, as do the workload and agent-domain negative tests. The executor's
two application tests, image and Helm contracts also pass. Architecture preflight, post-review and
mandatory independent review pass with no remaining findings. The independent review verified
lease expiry immediately before dispatch, response-stream cleanup, durable content validation and
required discovery fields; the added regressions cover each of those boundaries. This establishes
the shared protocol prerequisite, not connection activation or a qualified real retrieval journey.

Running MCP servers inside OpenCrane is also explicitly required. After the first remote business
journey, qualify a hosted MCP in a dedicated managed workload using the existing executor owner.
Shared discovery, tool permissions, approvals, invocation evidence and Absurd progression remain
the same. Hosted execution needs an explicit image-trust, scoped credential, connection generation,
provider egress and lifecycle contract; the current credentialless, restricted uploaded-image path
does not establish those capabilities. Keep it separate from the server process and the
ConversationComputer. This required T1 slice is not deferred with published applications/code work.

The hosted preflight found no reusable arbitrary connector credential store or provider-egress
profile. Model-provider Secrets remain model-only. Hosted admission must freeze an approved image,
connection owner/generation, exact scoped Secret reference and enforced destination policy. The
current standard Kubernetes NetworkPolicy contract cannot express FQDN restrictions; provider
egress stays denied until the selected destination policy is implemented and qualified. This is a
qualification dependency, not evidence that the current cluster has been inspected.

Personal approved actions are being implemented independently on
`feat/0.12-personal-tool-approval` from the same #851 base. Reuse the existing deferred approval and
elicitation authority, bind the request to the personal owner, and let Absurd resume the saved turn
after approval. Denial, expiry, changed authority and ambiguous effects must never dispatch another
call. Company approval tools remain unavailable until an entitled human approver and company
connection binding can be proven; a service Principal cannot substitute for either.
Independent review found approval-resume defects: the proposal reader rejected approved invocations,
the wake used a database row ID instead of the public invocation ID, and unanswered requests lacked
a durable expiry wake. The parallel lane is repairing those paths and adding an approval-to-execution
journey test. Personal approvals remain in progress until that complete path and restart behavior pass.

The bounded memory preflight confirms dataset-explicit recall and unavailable mutation methods.
Correction/forget must prove how gateway fact IDs map to the pinned Cognee document identity and
carry the admitted dataset. The available copied upstream source is not immutable-image proof.
Keep catalog records limited to metadata, provenance, consent and digest; existing Absurd workflows
own operation intent, checkpoints and recovery. No new memory outbox, scheduler or gateway
idempotency store is introduced. Remember, cross-conversation recall, correction and forget remain
unqualified until their identifier, receipt and ambiguous-response contracts are proven.

The bounded M1 contract-repair wave starts from immutable base
`abeed031373f8461b97f3a7ae6997e61c3348a5e`. Architecture preflight passed for extending the
existing memory-gateway client and shared memory contract without a route, schema, store, queue or
enabled mutation. Cognee CHUNKS identity is represented as separate document and chunk UUIDs;
future correction and forgetting must use the admitted dataset plus the document UUID. A write
result is transport evidence rather than durable or indexed completion, and unavailable mutations
prove that no request was sent. The source evidence is pinned to the version-matched Cognee `v1.2.1`
tag commit `15e48600cac49c6962fd688aaf783f5deda18660`; it has not been independently attested as the source
of the pinned OCI image digest, so it does not qualify or enable mutation.

The next recall journey also needs a dataset provisioning/availability owner and encrypted transient
result delivery. Personal run snapshots still select no memory scope, and ordinary tool-result JSON
is not suitable custody for recalled private facts. Reuse the existing conversation ciphertext store,
one-use memory permission and Absurd owners; only an opaque reference may enter invocation results.
A dormant recall task would be preparatory code, not a usable capability. Keep activation closed
until the admitted dataset, current permission, pinned gateway image and isolated live query are
proven. The #854 provider-coordinate contracts already exist and must not be duplicated.


## Absurd-owned conversation turn progression - 2026-09-09

Implemented in [#849](https://github.com/elewa-git/opencrane/pull/849), directly above
[#843](https://github.com/elewa-git/opencrane/pull/843), at `b4f275b3f`.
Conversation activation saves one `conversation-computer-turn` task through the existing Absurd
transaction boundary. The server workflow selects and advances durable model, optional tool-result,
continuation and output state; the Agent Sandbox Pod retains only its lease-fenced workspace,
checkpoint and review bootstrap. The private Pod bootstrap and `/model-step` scheduler paths are
deleted rather than retained as compatibility routes.

The change must preserve one original model dispatch and one permitted text-only continuation under
the original remaining allowance across process restarts. Terminal tool evidence wakes the exact
saved workflow in the same transaction. Stale leases, generations and ended authority fail closed.
Local validation, architecture post-review and independent review pass. The draft PR, CI and image
publication are complete; the change remains unmerged.
Fresh testv5 installation and live journey qualification remain a separate gate. Visible tool
progress, approval controls and user-facing recovery controls remain later slices.

## Library and component decomposition — 2026-09-09

Implemented in [#843](https://github.com/elewa-git/opencrane/pull/843), stacked on
[#831](https://github.com/elewa-git/opencrane/pull/831) at `b703e130a` after its develop merge.
The server app contains startup, configuration, lifecycle and declarative composition. Functional
libraries own behavior; inputs, agent services, conversations, IAM, contracts and workload identity
use capability folders. Conversation history and computer projections have separate Nx boundaries.
Frontend pages compose focused components and stores, with agent guidance preserving reusable
components and their interaction, accessibility and visual contracts.

The authority follow-up separates dispatch evidence, current access, proposal preparation and
credential lifecycle, preserving their shared transactions and original deadlines. Elicitation now
has four transaction-bound purpose owners. The final answer permission check runs at history append,
and the extracted history integration target remains in the KurrentDB CI job.

Local validation covers 125 affected projects and 260 build/test/lint tasks. One HTTP connection
reset passed on an isolated rerun of all 110 persona tests. The workspace rebase also passes 88
focused tests and eight browser interaction/accessibility cases. Prisma, authorization, workload,
dependency, release-baseline and style checks pass. Independent integration review covers the
rebased authority and access-loss behavior. Fresh CI on the published head remains required.

The retained macOS and Linux screenshot candidates need human visual acceptance. Their prior
[Linux comparison](https://github.com/elewa-git/opencrane/actions/runs/34335546198/job/102414280830)
passed 149 component tests and three visual comparisons at the earlier `967f7c0b6` checkpoint;
that result does not qualify this rebased head. No new screenshot candidates, deployment or live
qualification are included in this follow-up.

## Delivery focus — 2026-09-09

OpenCrane gives people and teams assistants that can work with company knowledge and tools,
while the company controls access, data, and spending. MVP means an employee can join, set up an
assistant, get useful work done, and collaborate in a group without understanding the runtime.

The current review order is `develop` → [#831](https://github.com/elewa-git/opencrane/pull/831)
→ [#843](https://github.com/elewa-git/opencrane/pull/843)
→ [#849](https://github.com/elewa-git/opencrane/pull/849)
→ [#850](https://github.com/elewa-git/opencrane/pull/850) for T1 company-tool selection.
The merged conversation history and
computer baseline is implemented; it is not yet a live-qualified MVP. [ADR 0016](docs/adr/0016-conversation-history-and-computers.md) supersedes the
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
| A1 — membership revocation and closed-work proof | IMPLEMENTED, IN REVIEW — standalone administrators can remove another non-Owner member through Settings. The server suspends the existing membership, protects Owner/self removal and rechecks current authority on retries. Workspace access loss clears retained private content and rejects delayed results. Focused unit checks and all 123 browser checks pass; five real PostgreSQL cases join the CI gate. The real-account removal and closed-work journey remains to qualify live. Fleet removal remains unsupported. |
| T1 — first permitted tool retrieval | IN PROGRESS — the server's one-tool continuation is implemented and now progresses through Absurd in #849. Company tool assignment is the first active follow-up. Connection activation, a real integration and participant result evidence remain required. |
| T2 | IN PROGRESS: personal approval and durable resume pass local integration; company approval and real external-action qualification remain. |
| U1 | IN PROGRESS: requester-only personal Stop passes source review and exact-head CI in #862; live qualification and wider participant controls remain separate. |
| M1 | IN PROGRESS: persistence, transaction-bound Absurd admission and catalog completion pass CI in #876–#878. The reviewed candidate shared-file repair passes all 31 image-qualification cases in #881. Authenticated composition, gateway/client integration and product memory journeys remain. The separate production-provider qualification still fails. |
| U2 | PAUSED: partial runtime-question source awaits its separate explicit approval. |
| F1 | IN PROGRESS: Ready-file access and PDF-informed answers pass CI in #868–#869. Generated CSV capture, scanning and answer-link recovery are implemented in #879 and pass four real-store cases in #880. The pending SQL guard and complete hosted execution/download qualification remain. |
| D1, S1, A2, T3 | PLANNED in the exact priority order above, with separate acceptance for each journey. |
| Q1 — operational acceptance | CONTINUOUS — source checks and CI do not replace fresh-install or real-account acceptance. |

The 10 September priority order supersedes the earlier overnight sequencing and morning handoff.
Execute bounded, independently reviewed slices on the live stack and record implementation, CI and
live evidence separately. Deployment, release tags and the full testv5 qualification remain separate
gates; no overnight automation is created by this plan.

## Extend the proven text journeys

The completed personal and group-assistant text path is recorded in [plan-done.md](plan-done.md).
The remaining acceptance work is broader than producing a first answer:

| Journey | Remaining work | Acceptance |
| --- | --- | --- |
| Keep login and activity continuous | Qualify the implemented PostgreSQL sessions on a fresh installation; new personal activity is proven. | Server replacement preserves login; people can find newly admitted completed work, with current access checked on every read. |
| Preserve access changes and closed work | Review the new standalone removal operation and browser purge, then qualify revocation and closure with real accounts. | Revoked or closed work stays inaccessible; late responses cannot restore its private history or draft. |
| Follow long conversations efficiently | Measure initial-history and periodic computer replay cost after the completed [#827](https://github.com/elewa-git/opencrane/issues/827) stream. | Long history has bounded read cost; reconnect retains ordered delivery and current access checks. |
| Perform a useful external action | Connect model tool requests to existing server-owned tool admission, approvals, execution and durable results. | One real task succeeds with a chosen integration; denied/revoked/ambiguous actions never execute or claim success. |

Group child chats and runtime delegation are distinct. [ADR 0012](docs/adr/0012-conversation-modes-and-agent-thread-authority.md)
requires a durable child conversation with independent access and history. The implemented human
request records its command and fixed audience with a recovery task, establishes cold history under
ADR 0016, then projects the child and commits its first message with activation. Only completed
creation becomes Ready. The company assistant uses its own managed identity and model permission;
the human requester's current membership and invocation permission remain separate requirements.
Runtime subagents
([#845](https://github.com/elewa-git/opencrane/issues/845), building on #320) require explicit parent-run delegation,
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
  [#848](https://github.com/elewa-git/opencrane/issues/848), building on the retired #332 work.
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

### Personal approval slice — implementation and local integration complete

This owned slice is stacked on PR #852 at `abeed031373f8461b97f3a7ae6997e61c3348a5e` and keeps approval-gated
personal tools in the existing model/proposal loop. The model receives frozen definitions; a personal
proposal preserves its arguments, schema digests and original run allowance, records a deferred IAM
request assigned to the run's exact `Principal.subject`, and pauses the saved Absurd turn in
`WaitingForInput`. An owner decision marks the invocation ready or terminally failed, then wakes the
existing turn event so restart and duplicate admission reuse the same invocation without another MCP
dispatch. Expiry, stale fencing and changed arguments fail closed.

Managed company approval tools remain filtered at model selection and rejected before proposal
preparation because the entitled human resolver and connection authority are not yet bound. The
remote credential/connection schema therefore remains an integration boundary for the next slice;
this personal approval path does not claim a live remote effect.

Validation evidence: the final disposable PostgreSQL run passes proposal (`17`), approval (`3`),
result (`4`) and all authority SQL checks after the mixed-batch wake repair. Full conversation coverage (`467`) passed, full
elicitation coverage (`45`) passed with permitted HTTP listeners, IAM coverage (`243`) passed,
OpenCrane lint and build passed, and Absurd adapter coverage (`33`) plus lint passed. PostgreSQL
integration and OpenCrane lint also passed after stacking onto #852. Independent review and
architecture post-review passed. These are source and integration checks; no live remote-provider,
hosted-MCP or fresh-install qualification is claimed here.

### Selected-conversation elicitation discovery — source validated, review passed

The authenticated browser API can list up to fifty current requests assigned to the caller in one
selected conversation. The existing elicitation authority checks active membership, current
participation and central Conversation/Read permission before returning the browser-safe request
projections. The Activity index and named request read remain separate capabilities.

This slice does not mount the existing elicitation card or add a polling, queue or scheduling path.
An authoritative live trigger and exact human-readable tool, action and safe-argument disclosure
remain required before the product can claim a visible informed-approval journey. Remote-provider
metadata and live provider qualification remain separate work.

Validation evidence: elicitation authority (`50`), frontend elicitation state (`8`) and shared
contracts (`122`) tests pass. All three focused TypeScript lint targets, generated-client replay,
ESLint boundaries, agent style, Prisma boundaries and module growth pass. The five style warnings
name pre-existing response-outcome comparisons; no warning names added code. Independent integrated
review and architecture post-review pass with no findings.

CI caught a missing website OpenAPI snapshot after the typed client was generated. The website
snapshot is now synchronized with the same emitted schema, and the documentation build passes.

### Visible personal tool approval — source implementation complete

This slice is published in draft [#857](https://github.com/elewa-git/opencrane/pull/857),
directly above draft #856 at immutable base
`b9b362f0ed7ceeef6212f1c4ef1c799e69243913` on
`feat/0.12-visible-personal-tool-approval`. The integration branch is `develop`, observed at
`d4bd0213c38e4fa70cbc3d93535857da9e381a32`; live ancestry is refreshed before publication.

Three parallel lanes reuse the existing owners: IAM freezes reviewable arguments and human tool
labels in the saved elicitation body; Absurd publishes an approval-requested history fact before
waiting; the workspace mounts the existing card and store and refreshes from that fact without
polling. The shared contract distinguishes reviewable arguments from a denial-only request whose
secret fields cannot be shown. Other approval purposes retain their existing bodies.

Architecture and component preflights and independent backend/frontend post-reviews pass. The
history owner atomically saves the receipt and entry, rechecks current recipient access, and verifies
the original receipt after an uncertain response. Only the assigned participant receives the generic
history fact; action details come from the authorized elicitation read. The browser's decision never
supplies replacement arguments or dispatch authority. A later message does not replace a saved
proposal or its input; current run, approval, permission and lease checks still govern execution.

Review found and corrected a narrow-screen clipping defect and stale private disclosure after an
authoritative denied read. Messages and approval details now share a scrolling body with the
composer retained in view. Current denied discovery, exact reads and post-submission reconciliation
clear the private request and draft immediately.

Validation includes 477 conversation tests, 245 authorization tests, 52 elicitation tests, 31
observability tests, 122 contract tests and 28 history tests. The full fresh PostgreSQL target passes,
including 17 proposal, 3 approval, 4 result and 5 profile-repair tests. The real turn and history-owner
fixture proves notification and final-answer recovery without repeating the original model request,
tool execution or allowance. Server and production UI builds and the generated client/website
checks pass. Frontend checks pass: 72 focused unit tests and 163 Storybook interaction/accessibility tests.
Seven approval states have reviewed desktop/narrow references. The complete local visual comparison
also found ten missing macOS references for unchanged stories; these have been visually reviewed
and added beside their existing Linux references. The full macOS visual target passes all three
checks, covering 120 tagged states and desktop layout contracts. Style reports zero errors and
warnings; Prisma, dependency, workload and domain guards and their relevant negative tests pass.
Module-growth review confirms that the elicitation store owns one request lifecycle. Linux CI run
`34573115276` on `0f1da615829e36d28f9467c6bf79468134567b5d` passes the real KurrentDB,
database, generated API and all 163 Storybook interaction/accessibility tests. Seven Linux visual
references differed from their initial macOS-seeded images. The exact Linux renders from artifact
`10188675908` passed independent visual review and now replace those seven references; production
source and comparison tolerances are unchanged. Run `34574153065` passes on exact source
`5a4e3bcf5d1ee2e2b1069984854866681ffd9d2c`, including Linux visual comparisons and all eight
affected image publications. The incremental draft PR
records validation and the review order; company/connection and live acceptance below remain open.

Company approver resolution, remote connection-owner disclosure, live provider effects and testv5
qualification remain separate gates. The pending testv5 deployment approval does not block this
source work or authorize changing the test environment.

### Testv5 access repair — preserve existing data

Fresh owner sign-in succeeds. The remaining onboarding denial is `service_not_ready`: the exact
personal service still names `personal-default`, while the current server admits `developer`.
Read-only inspection found no conversations, runs, computer leases, child requests or tool claims
for that service. Its owner, approved persona and completed onboarding evidence are valid.

The user requires all current test data to be preserved. Architecture preflight permits a narrow
completed-onboarding correction only for that unused deterministic service, with an unconfigured
old profile, current central Edit permission, and a transaction-bound source comparison. Used
services and retained profiles remain denied. Agent-services tests (140), onboarding tests (49),
actual composition tests (5) and fresh PostgreSQL repair tests (5) pass. The SQL proof covers current
Edit denial, audit rollback, exhausted source comparisons and concurrent conversation creation;
the existing onboarding transaction retries conflicts and refuses a service that becomes used.
Relevant type checks, the server build, style, boundaries and module-growth checks pass. Independent
review and architecture post-review pass. The source is published in draft #855 at
`26ffbf65447a96e9f928754af5c81eab475010bc`. The minimal deployment candidate
`a198ff2431511a55673f2c137a42b861d03c8247` is stacked directly on the deployed server source.
Normal CI run `34478251765` passed and published server image digest
`4e259a6ef71086513d611973e4e97754671902553b6f35bce2550d4e81d90c50`. Read-only preservation
inspection and the final read-only preflight pass. Explicit approval for the live installation
remains pending, and no live database, deployment, identities, conversation history or stored files
have been changed.

The live PostgreSQL release metadata and deployed server manifest carry different baseline digests.
This is an unresolved provenance problem; the readiness schema was read successfully and the
profile mismatch, not a demonstrated missing table or column, caused this denial.
The deployment candidate applies only this repair to the current server source. The existing
installer reconciles PostgreSQL Helm values but preserves the existing cluster's baseline binding;
it does not apply the source baseline to that database. This development repair cannot count as
fresh-install or release qualification.

## Later work

- [#765](https://github.com/elewa-git/opencrane/issues/765): Git-backed project source, isolated
  builds, immutable published artifacts, PreviewApps and code work after the ten priorities above.
- Warm pooling, extra compute tiers and scale optimization wait for measured latency and cost.
- A generic plugin framework waits for two concrete consumers that need the same extension contract.
- [#513](https://github.com/elewa-git/opencrane/issues/513): evaluate provider-native model tracing
  without prompt/response content export by default.

Version-to-version upgrades return with an explicit MVP upgrade contract. Until then, preserve one
clean baseline and delete superseded code in its owning replacement slice; use git for history.

### Memory candidate path-safety harness correction — 2026-09-12

The exact #870 head `6a12061dd5265c99433f929b015bdc0eef076c33` reached the path-safety phase in
run `34687912613`, then stopped before those assertions with an import error. The installed and
source-attested class is `SQLAlchemyAdapter`; the fixture imported `SqlAlchemyAdapter`. The fixture
now uses the exact installed class name. Path ownership, interrupted deletion and all earlier
provider assertions remain required. This is a harness correction, not provider qualification or
permission to enable personal memory. The production 1.2.1 deletion failure remains unchanged.
