# OpenCrane — Active Plan

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
| 1 | T1 — real tool retrieval | A permitted real record reaches an answer in personal and company-child chats; remote MCP connections and hosted MCP execution have qualified journeys. Results survive reload and restart without repeated dispatch. | IN PROGRESS: company tool selection and participant terminal-result history are implemented and result-history CI passes. Standard remote connection activation awaits its recorded approval, then one real integration and the required hosted MCP slice follow. |
| 2 | T2 — approved external actions | A person reviews an exact action and arguments; one approval permits that effect once. Denial, expiry, changed arguments and revoked authority prevent it. | IN PROGRESS: personal approval, expiry, durable resume and visible decision controls are implemented in draft #857. Company approver/connection binding and real action qualification remain. |
| 3 | M1 — long-term memory | Explicit remember, cross-conversation recall, correction and forget work with consent and isolated datasets. | IN PROGRESS: qualify the pinned provider's isolation, identity, restart and deletion contracts on disposable CI data before implementing personal dataset provisioning and explicit Remember. |
| 4 | U1 — visible work controls | People can follow waiting, running and terminal work, make supported decisions and cancel eligible work after refresh. | IN PROGRESS: requester-only personal Stop and durable cleanup pass independent review and exact-head CI in draft #862; qualify the live journey. Other-participant controls remain a separate actor-policy decision. |
| 5 | U2 — rich interaction | Durable choices, free text, structured results and A2UI remain usable and accessible after refresh. | PAUSED: runtime-question source work awaits its separate explicit approval; partial implementation is not validated delivery. Structured results and A2UI remain. |
| 6 | F1 — documents and generated files | A scanned document can inform an answer, and a generated file remains downloadable by its authorized audience. | IN PROGRESS: Ready-file Open/Preview/Download is implemented and exact-head CI passes in #868. PDF-informed answers are the active source slice; generated file production follows. |
| 7 | D1 — autonomous delegation | A bounded child works with explicit context and narrower authority, then returns one durable result. | Follow [#845](https://github.com/elewa-git/opencrane/issues/845): root budgets, depth/fan-out, cancellation and result brokering. |
| 8 | S1 — scheduled work | A reviewed routine fires under current authority with explicit overlap, retry and missed-run policy. | Follow [#848](https://github.com/elewa-git/opencrane/issues/848) through Absurd and existing admission. |
| 9 | A2 — complete administration | Operators configure agents, connections, models, permissions and budgets, and inspect effective access and actual usage. | Complete protected settings over the owners established by the earlier tracks. |
| 10 | T3 — action recovery | People and operators can reconcile uncertain effects, inspect cancellation races and perform supported safe retries. | Add provider-specific reconciliation and repair controls over durable invocation evidence. |

Every earlier track includes its required current-authority checks, bounded retries, lease/generation
fencing and honest failure state. Priority 10 is the complete recovery experience; it is not a reason
to defer duplicate-effect prevention. [#844](https://github.com/elewa-git/opencrane/issues/844) spans
retrieval, approval, controls and recovery; its full acceptance closes only when those slices pass.
The [delivery plan](docs/design/mvp-delivery-plan.md) records owners and acceptance for each slice.

### First execution slice: company tool selection

Implemented in draft [#850](https://github.com/elewa-git/opencrane/pull/850) on
`feat/0.12-real-tool-retrieval`, directly above
[#849](https://github.com/elewa-git/opencrane/pull/849), with immutable review base
`b4f275b3f090e9387a1b0de658968700c0b7ad04`. Reuse the earlier company-tools implementation and
adapt it to #843's capability folders; do not reopen its obsolete flattened implementation.
Architecture preflight passes for the existing agent-services, revision and execution-evidence owners.

An administrator reads and replaces the assistant's exact tool selection through the API. One
transaction publishes an immutable successor revision and its service-owned grants, with current
Administer/Assign checks and a comparison against the expected active revision. Tool edits preserve
the saved model budget. New company assistants receive the two-call limit needed for one tool result
and one final answer. Dispatch continues to use the company identity; a person's private permissions
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
| M1 | IN PROGRESS: #863 qualifies the exact provider image. Isolation and restart recovery pass in the authenticated candidate, but final-reference deletion leaves original source bytes; provider repair and product memory journeys remain. |
| U2 | PAUSED: partial runtime-question source awaits its separate explicit approval. |
| F1 | IN PROGRESS: Ready-file Open/Preview/Download passes exact-head CI in #868. PDF-informed answers are being integrated and reviewed; generated outputs follow. |
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
