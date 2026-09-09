# @opencrane/backend/server/conversations — participant conversation authority

> [backend](../../../README.md) › [server](../../README.md) › conversations

## What it owns

This package owns the signed-in participant's conversation API, canonical timeline and authorised
stream transports. It creates conversations in exactly one immutable mode: `agent_session`,
`direct`, or `group`. An agent session binds one agent service; direct and group conversations do
not bind an agent and their ordinary messages never manufacture runs.

Sending a human message rechecks current membership, participation, lifecycle, child access and
Conversation Use inside the Serializable transaction that stores its ciphertext. That transaction
records Use against the winning payload reference, ciphertext digest, retry UUID and activation,
then updates conversation ordering. A changed-text retry rolls back its admission before commit;
plaintext stays outside repository arguments and SQL. KurrentDB receives the opaque reference after
commit. Stream-conflict retries and computer-turn compilation use pure current-eligibility checks;
new runs still pass through their existing recorded admission.

Interactive computer review commands, browser actions, screenshots and previews still need their
own concrete effect-admission binding. Their `reviewCoordinates` path retains the Read-class guard
and fails closed when asked for Use; this message repair does not enable them through an eligibility
check. Human-reviewed group-child text sharing uses its separate recorded admission and remains
available through that existing path.

For assistant turns, the server keeps the compiled prompt and model credential. Bootstrap gives
the verified Pod a turn id and `ready`, `pending` or `response_unavailable`. A ready Pod requests
`POST /api/internal/conversation-computer/model-step` with exactly `{bootstrapId}`. The server
chooses the next step from saved progress; the Pod cannot submit an ordinal, tool proposal, prompt,
model, budget or output. The former private `/tool-proposal` and `/output` routes are removed.

The first model request may return text or select one unambiguous, frozen tool that requires no
approval, provided the original run allows a tool and two model calls. Before tool admission, the
server encrypts the accepted declaration, including the original call id and argument text, and
records its private selection. The existing PostgreSQL transaction saves the invocation and its MCP
(Model Context Protocol) executor work together. Identical retries recover that work; changed
arguments are refused. Proposal audits use the verified conversation Pod and saved run, while
execution audits use the current executor Job and Pod.

Tool permission checks live in `src/computers/tools/dispatch/`. The dispatch authority orders three
checks: the saved run and its original budget, the current identity and computer lease, then current
membership, conversation access and tool permission. Each reader has its own contract and tests.
They share the caller's database transaction; none opens another transaction or sends a provider
request. The same checks protect proposal admission, executor claims and completed-result reads.
Missing or inactive facts refuse the operation. A history failure throws so tentative database work
rolls back. The final expiry is the shortest original or current limit, checked again after all reads.

`src/computers/tools/proposal/` separates saved-input and one-call-slot checks from permission evidence
and invocation preparation. The proposal coordinator keeps those steps and executor admission in one
Serializable transaction. A refusal after any tentative write rolls the complete proposal back.

`src/computers/turns/credentials/` separates stored credential state, encrypted receipt verification,
provider issuance and cleanup. A missing row may win one key-creation claim; a saved row can only
recover that key or finish cleanup. Expired, revoked or uncertain work cannot mint a replacement.
Provider calls stay outside database transactions, while conditional writes decide which caller owns
each state change.

A saved declaration can recover after a restart without another first model request. The server
checks current authority and the exact terminal result through the IAM (identity and access
management) result owner, then encrypts the original assistant declaration paired with that result.
It reserves the second request before acknowledging result delivery. Only the live caller that wins
that reservation may dispatch, using the same model key and the original token allowance minus the
entire first reservation. The second request offers no tools and must return text. Intermediate tool
progress is not appended to participant history, so the original conversation head and compiled
input remain unchanged until the final answer.

Each reservation consumes its gateway request across competing callers and restarts. The server
saves the encrypted answer and complete event intent before appending conversation history; recovery
finishes that same answer. An unsaved response reports pending until its fixed deadline, then
unavailable without another paid dispatch. The run remains pending for future recovery controls.
This bounds OpenCrane's admitted requests; LiteLLM and provider-internal retries have not been
qualified as exactly-once execution. The continuation implementation in PR #830 awaits CI and live
qualification; it does not complete the first permitted retrieval journey.

Before an MCP executor claims a saved run-owned tool call, this package rechecks its current
Running run, unchanged execution subject, conversation participation, identity and exact active
computer lease. Existing service and membership owners supply fresh evidence; the central
authority re-admits Conversation Use and every saved tool coordinate. Revoked permission becomes
a definite failed invocation before provider dispatch. An unavailable history store leaves the
transaction uncommitted for retry. Kurrent reads and PostgreSQL decisions remain separate
observations. The original run deadline and tool allowance remain binding at both proposal and
dispatch. The executor claim expires at the earliest run, lease or membership-trust deadline, or
sooner if its configured claim duration ends first. The saved invocation, executor command and
returned command share that deadline; delayed writes and retries cannot extend it. Company
revisions with tool assignments remain refused by their current owner.

The creation directory lists active members in the current silo with their stored display names.
Missing names use a generic label; login subjects and email addresses never become fallback names.
The browser reuses this directory for participant selection and direct/group chat titles.
Existing conversations retain opaque references for suspended peers while still requiring the caller's
current membership, participation, and Read permission. A physically deleted membership is omitted
from those references, so the displayed participant count covers only resolvable memberships.
Metadata converts every generated Prisma mode and lifecycle into the public lowercase values.

Every conversation creation requires a client UUID. Ordinary direct/group requests keep one
conversation identity across retries. The first PostgreSQL creation commit fixes the member set; a
genesis-only failure has not accepted members. Competing changed member sets cannot both succeed.
Retries return the current projection without reopening the conversation, changing participant
positions, or reconciling grants. The serializable transaction retries only proven rollbacks.
Genesis verification reads only the first history record with a ten-second timeout. A timeout leaves
the same command safe to retry and cannot make existing messages part of creation verification.

Computer history uses the same metadata shape on write and read: strings for present coordinates,
and no lease fields while the computer has no lease. The typed snapshot retains numeric generations
and a nullable lease; the reader checks those values against the stored metadata before activation.

Personal-session creation requires the same client UUID contract. Retrying that command returns the same session,
even after its computer has started; a new UUID creates another conversation and computer for the
same personal assistant identity. Reusing a key with a different assistant is rejected. Recovering
an existing projection preserves its lifecycle and current grants, including any revoked access.

A group member can select one of their own text messages and ask the company assistant to work on
it in a shared child conversation. The source must be visible to every current group member; a
private message or a message older than a member's joining point cannot silently become shared.
The child keeps the admitted audience and the company's managed identity. It inherits no member's
personal tools, persona or memory. The parent group remains an ordinary conversation without its
own agent identity. Retrying an admitted request after somebody joins preserves that original
audience and rechecks the caller's current source and child access.

Creation returns a pending request. PostgreSQL stores only the immutable command, source coordinates,
selected service and audience, together with its durable recovery task. The worker establishes the
child's Kurrent history and cold computer before creating its read projection. It then encrypts a
copy of the selected text and commits the child message together with its activation request.
Failure logs identify the creation stage and recognized error code without copying the upstream
exception, user text or credentials. Only that completed sequence makes the child ready. Retries verify the same origin, preserve
existing grants and ciphertext, and do not reactivate the same message. Revoked authority closes the
request; exhausted dependency retries report unavailable. The list returns the latest 100 admitted requests. A new run still requires an active,
Pod-bound lease and the selected company's current execution authority.

Child lists, breadcrumbs, history, event streams and prompt decryption require continuing access to
both child and parent. Rejoining the group does not expose a request before the new joining point.
The directory offers only company assistants whose current identity and invocation permission are
ready. Group participants receive the central Delegate capability; direct and personal sessions do
not gain that capability from this participant policy.

Returning a result is a separate human action. The member reviews or edits a completed assistant
answer, then shares that text as their own group message. The server verifies the child source,
links the parent reply to the original request and binds the retry UUID to the exact reviewed text.
It encrypts a new parent payload instead of copying private child references. The assistant receives
no automatic writer to the parent group.

```
 authenticated participant
          │ directory · list · create · history · message · archive · close
          ▼
 ┌──────────────────────────────────────────┐
 │ conversations  ◄── HERE                   │
 │ immutable mode · participant coordinates │
 │ Kurrent entries · encrypted payload read  │
 └──────────────────────────────────────────┘
          │ agent-session message       │ direct/group message
          ▼                             ▼
 Agent Sandbox computer           canonical entry only
```

**In this flow:** [history store](../../../server/infra/history-store/README.md) ·
[Agent Sandbox](../../../../../apps/_infra/agent-sandbox/README.md) ·
[conversation workspace](../../../../frontend/features/conversation-workspace/README.md)

Message admission dispatches through the persisted mode strategy. A direct or group message commits
as a canonical message without an `AgentRun`. An agent-session message first commits as the canonical
Kurrent entry and activates its conversation computer. After the lease-bound Pod claims that turn,
bootstrap passes the pre-persisted entry coordinate into durable run admission, which stores the run
and immutable input without writing a duplicate relational message. A single active foreground run
blocks another agent-session message. The public API does not expose a separate run-start route.

The general conversation unit of work owns participant reads and aggregate lifecycle writes. After
the active computer history and lease-bound Pod have checked out, turn compilation rechecks the
pending entry's exact author Principal, active membership, participation, conversation Use grant,
and published revision. It then calls an application-supplied run-admission port with only those
server-resolved coordinates. That port owns durable run assembly and returns the compiled immutable
input. A denial fails bootstrap closed; the conversation package never creates an execution subject
or treats computer-supplied coordinates as authority.

Review-credential and bootstrap failures keep the private transport's opaque 409 response.
Each warning identifies the fixed operation and a recognized error class and code; it excludes
credentials, model input or output, request coordinates and upstream error text. The internal
listener supplies request correlation and logging before these early handlers run.

Before model dispatch, the server rechecks the original run deadline, execution and requester
membership expiry, current permission and active lease. It saves the smaller of the frozen response
and run completion-token ceilings, and a dispatch deadline no later than 25 seconds or the remaining
authority. Credential issuance and the HTTP exchange share that deadline; the Pod's private request
allows 30 seconds. An unavailable response keeps the reservation instead of issuing a replacement
allowance or key on bootstrap. Grant revocation closes new model dispatch, output append and
participant reads; it does not prove cancellation of a request already accepted by the provider.

Attempt-key issuance uses the configured silo authority independently of the Kubernetes namespace.
It commits encrypted custody before a separate ready-state promotion. If promotion and immediate
provider cleanup both fail, the custodied row remains decryptable for a later cleanup or retry.

Before appending assistant history, the turn store saves the complete prepared event: its author,
timestamp, position, metadata and encrypted payload reference. This intent contains no answer text
or credential. Concurrent preparation returns the stored winner, including its original timestamp.
After a restart, the server recovers that exact answer for the current Pod, completes the fenced run,
revokes its model key and settles the active-turn pointer before another turn starts. Saved-output
recovery runs before recompiling current history, which may already contain the accepted answer.
Reusing an output identifier with different text is refused by the encrypted payload owner. The
private manual-output route is removed; output admission requires the winning server model reservation.

`BoundConversationWriter` is the KurrentDB-facing computer boundary. A caller mints one binding for
one silo, conversation, computer lease generation, agent identity, run, and expected stream
revision; the writer prepares its agent author, stream position, timestamp, and Kurrent event
metadata for the turn store to save before one append. It accepts only opaque participant-entry references, checks the
requested audience through a current visibility policy, rejects an attestation from the computer,
and enforces byte and rate limits during preparation. Recovery reads only the frozen next position
and requires the complete stored event to match; an event identifier alone cannot prove acceptance.
An empty position still requires current visibility and the original lease/run/input fence before
append. A matching answer can finish bookkeeping without recompiling input that its own append
already advanced. The turn coordinator verifies the current Pod and lease before either path.
The writer cannot select another stream or append a second distinct entry. A different event,
unavailable history, or a replaced lease leaves the turn unresolved.

`ConversationComputerHistory` owns the separate deterministic KurrentDB stream for the logical
computer itself. It accepts complete, closed computer and lease snapshots only through the narrow
HistoryStore port, checks their stream revision on every append, and replays them against the current
head before returning state. A later pre-admission composition can ask it only for the exact silo,
conversation, AgentIdentity and profile it already selected; it receives an active lease only when
the matching computer is currently warm. A missing, retired, cooling, released, lost, malformed, or
cross-coordinate snapshot fails closed. This history authority does not create a sandbox claim,
activate a sandbox, use PostgreSQL, or receive a direct KurrentDB client.

The participant history API rechecks current PostgreSQL membership, participation, and central
product authorization before it reads `conversation-{id}`. Text enters a purpose-specific mounted
AES-GCM keyring boundary before PostgreSQL persistence; KurrentDB receives only an opaque payload
reference and ciphertext digest. The response leaves each immutable entry unchanged and returns
separately authorized plaintext in a payload-reference map. A `start` message commits its entry and
checked computer generation to the silo activation queue through one atomic KurrentDB append.
`interrupt` remains denied until a distinct authority can prove and fence the execution it stops.

Unexpected history reads and message posts return an opaque 503 and emit a warning in the
`conversation.history.read` or `conversation.message.post` trace. Diagnostics include the trusted
silo and principal, a known Prisma or JavaScript error class, and a recognized protocol or database error code.
Messages, retry keys, URLs, cursors, upstream error text and database details are excluded. Expected
access denials and message conflicts keep their existing 404 and 409 responses without warnings.

Before creation, the directory returns active organisation members as opaque membership references.
It never returns login subjects, email addresses, roles, or personal-memory identity. It also
selects personal services from the caller's current approved persona before checking their current
read permission. Another member's private assistant cannot make the caller's assistant unavailable
or ambiguous. Exactly one authorised match returns the assistant; no match is unavailable and more
than one match is ambiguous, so the server never silently chooses an Agent.

The directory and create transaction also use the central product catalogue. Selected membership
references require exact `OrganizationMembership/Read`; an agent target requires
`AgentService/Read` and admitted `AgentService/Invoke`, while the approved persona requires admitted
`Persona/Use`. The create itself consumes the silo's typed `ConversationCollection/Create` grant.
The same transaction writes participant grants for Discover, Read, Edit and Use, plus Delegate for
groups and Delete only
for the new conversation's creator. Existing conversations without trustworthy creator provenance
remain fail-closed for Delete.

Every conversation read and mutation evaluates the caller's current Principal plus direct stored
Group memberships through `AuthorizationAuthority`. A direct Principal grant and an inherited Group
grant therefore receive the same decision semantics, including deny precedence, expiry, and
revocation. `ConversationParticipant` remains a lifecycle and projection coordinate: both grant
forms still require current participation so visible timeline bounds, archive state, unread state,
and ended access cannot be bypassed by authorization alone.

The participant message endpoint currently accepts text only. Conversation asset upload and
scanning have their own boundary; attaching an uploaded asset to an ordinary message is pending.

Archive and close are deliberately different. Archive is reversible and affects only one
participant's list. Close is permanent, applies to the conversation, and makes it read-only. Each
participant separately records the first visible position, the last read position, and an optional
access-ended position; reads are clipped to those bounds and writes require continuing access.
The server rechecks organisation membership and participant bounds on every history page. The
browser event route resumes after the last observed immutable stream position. A
revoked participant loses both entry access and private payload resolution rather than receiving an
empty successful page.

## Glossary: the coordinate words and where each lives

Every conversation-computer command carries the same handful of identifiers. The words below each
have one meaning in this package, and each identifier lives in exactly one of the three bundles from
`@opencrane/contracts` (`ComputerScope`, `LeaseScope`, `AgentScope`) or in a named command field.
Persisted and wire shapes keep their own flat names (`generation` on Kurrent events and Pod labels,
`computerScope` inside the stored execution subject) and are mapped at the boundary.

| Word | One meaning | Bundle or field |
|---|---|---|
| **lease** | One sandbox realization of a logical computer. A computer has zero or one active lease; the lease id is a public label derived from the computer id and generation, never a secret. | `LeaseScope.leaseId` |
| **generation** | The count of realizations a computer has had; it grows by one on every new claim and fences out a replaced or stale Pod. Always paired with the lease id. | `LeaseScope.leaseGeneration` (stored as `generation` on Kurrent events, Pod labels and SandboxClaim labels) |
| **claim** | The Agent Sandbox `SandboxClaim` that realizes a lease, named `<computerId>-g<generation>`. Also: the row-level fence a credential transaction holds (`claimFence`). | `ClaimedLeaseScope.sandboxClaimId`; `claimFence` on the credential row |
| **credential** | The attempt-scoped LiteLLM key stays server-side (`ConversationComputerCredentialIssueCommand`); the derived review-gateway bearer alone goes to the bound Pod (`ConversationComputerReviewCredentialGrant`). Neither is persisted in history. | Command fields, never a bundle |
| **activation** | Waking a computer for one requested generation, from the silo activation queue through the SandboxClaim to an active lease. | `ConversationComputerActivationCommand` (flat, because it runs before the identity or lease exists) |
| **admission** | The server-side decision that lets work start: run admission compiles the pending human entry into an immutable run input after rechecking the requester, computer, agent and lease. | `ConversationComputerRunAdmissionCommand` = `computer` + `agent` + `lease` + requester fields |
| **fence** | Any comparison that stops a stale actor: the lease generation on every durable write, the active-lease row on PostgreSQL approvals, the claim fence on a credential row. `_AssertFencedRowCount` documents the row-count form once. | Field of whichever bundle is being compared |
| **checkpoint** | The verified immutable workspace archive captured before a lease is released and restored into the next realization. | `ComputerWorkspaceCheckpoint`; restore is addressed by `siloId` + `computerId` + `LeaseScope` |
| **receipt** | The saved intent for one complete answer event, including its encrypted payload reference. Exact conversation readback separately proves that event was accepted. | `ConversationComputerTurnOutputReceipt` |
| **envelope** | The Pod's bootstrap response contains a turn id and outcome. The saved output event envelope separately contains the prepared entry and metadata needed to recognise its exact history append. Neither contains model credentials or prompt text. | `ConversationComputerBootstrap`; `ConversationComputerTurnOutputReceipt` |

The bundles themselves: `ComputerScope` (`siloId`, `conversationId`, `computerId`, `agentIdentityId`)
says which computer; `LeaseScope` (`leaseId`, `leaseGeneration`, plus `sandboxClaimId` or `expiresAt`
where a command needs them) says which realization; `AgentScope` (`agentServiceId`, `agentRevisionId`,
`profileRevisionId`) says which service, revision and profile the turn runs under. Pod-facing paths
that only know the silo, computer id and lease use `ConversationComputerLeaseCoordinates`.

## Public surface

`PrismaGroupChildAuthority`, `_CreateGroupChildRouter` and `GROUP_CHILD_TASK` compose the explicit
shared group-child journey and its durable recovery worker. The public routes are
`POST/GET /me/conversations/{conversationId}/children` and
`POST /me/conversations/{conversationId}/share`; ordinary detail adds a nullable `parent` origin.

- `_CreateSelfConversationsRouter` composes the privacy-safe creation directory, participant-bound list, create, message,
  history, archive, and close API over Prisma and KurrentDB. All
  identity and authority coordinates come from the signed-in route and are rechecked transactionally.
- `_SelfConversationsOpenapiPaths` contributes the remaining REST metadata and lifecycle APIs to the
  server-owned OpenAPI document.
- `BoundConversationWriter` is a one-use, stream-bound KurrentDB append boundary for a currently
  leased computer. Its supporting binding, clock, rate-limit, visibility-policy, and lease-fence
  contracts keep the computer unable to select a target stream or stamp a trusted entry coordinate.
- `ConversationComputerTurnAuthority` serves private bootstrap and model-step requests. It reserves
  the first request, retains any accepted tool declaration, and may reserve one final request from
  the verified result. The server-only model-routing port and saved output remain behind this owner.
  Model-step returns `completed`, `pending`, `response_unavailable` or `authority_ended`;
  none of those outcomes reveals model input, credentials or response content to the Pod.
- `__RunConversationComputerActivationListener` consumes one silo-scoped, persistent KurrentDB
  activation subscription in delivery order. It validates the stream-bound command before calling
  the computer authority, parks malformed input and an explicitly parked authority outcome,
  acknowledges activated, idempotent, or denied outcomes, waits with bounded exponential backoff
  before retrying a pending sandbox assignment or a transient authority failure, and leaves an
  acknowledgement failure for KurrentDB to redeliver.
- Parked activation replay belongs to the deployment maintenance command `--kurrentdb-replay-parked`.
  The application history identity can consume, retry and park deliveries, but cannot administer the queue.
- `ConversationComputerLifecycleAuthority` measures idleness from the newest turn activity on the
  lease's active-turn stream (`KurrentConversationComputerActivityReader`), renews an in-use lease at
  half of its lifetime, records an expired or claim-less lease as `lost` with a cold computer, and
  otherwise cools, checkpoints, and releases. It compares claim lag at Kubernetes' whole-second
  timestamp precision so discarded milliseconds do not trigger repeated renewals. Activation opens
  generation + 1 from `released` or `lost`.
- `ConversationComputerHistory` persists and reloads full computer and lease snapshots on one
  deterministic KurrentDB stream. Its checked current-head result lets future pre-admission code use
  only one matching warm computer with one active, generation-fenced lease.
- `ConversationComputerActiveLease` is the rebuildable PostgreSQL transaction fence for effect and
  approval admission. Activation publishes it only after KurrentDB records the Active lease;
  lifecycle cleanup clears the exact row before recording release or deleting the SandboxClaim.
- `_CreateSelfConversationHistoryRouter` exposes exclusive-cursor KurrentDB reads and encrypted
  participant message admission without a relational transcript fallback.
- Its optional public `GET /me/conversations/:conversationId/events` route streams authorized history
  pages over same-origin server-sent events (SSE). Each page rechecks current Read permission and the participant's
  `visibleFromPosition`; private payloads are resolved only after those checks. `Last-Event-ID`
  resumes after an immutable stream revision, including cursor progress over hidden entries.
  Disconnect closes both catch-up reads and the wakeup subscription. The existing full-history
  response keeps its finite full-scan behavior; this event transport does not make that API paged.
- Event connections last at most 60 seconds, close after 30 seconds without new history, and refresh
  authority every 10 seconds while quiet. A connection allows 128 history frames, 512 KiB per frame,
  2 MiB in total, and five seconds of socket backpressure. Each listener process permits two active
  streams and twelve starts per minute per authenticated silo/subject; replicas enforce their own
  limits. Terminal `unavailable` frames carry fixed error codes and stop automatic replay.
- `PrismaSelfConversationHistoryUnitOfWork` joins current PostgreSQL authorization and encrypted private
  payload persistence to checked KurrentDB operations.
- `PrismaConversationComputerTurnUnitOfWork` rechecks the pending human author's current authority
  before handing server-derived lease, identity, revision, and requester coordinates to the injected
  run-admission port. It accepts compiled input only for the deterministic first attempt.
- `PrismaConversationToolProposalUnitOfWork` saves and prepares one permitted proposal, then queues
  its existing executor in the same transaction. The app supplies a
  `ConversationToolProposalRuntimeAdmission` callback bound to that transaction. Its repository
  retains identical retries, rejects changed content and keeps the original run budget binding.
- `KurrentConversationHistoryAdmissionReader` re-reads one exact stream revision and returns its
  completed message order plus the immutable final human author to durable run admission.
- `PrismaKurrentConversationPromptMessageRepository` resolves that admitted message set through
  conversation-bound encrypted payload rows. It verifies the silo, conversation, payload reference,
  author and ciphertext digest before decrypting, and has no relational transcript fallback.

## Boundary

The self API receives only server-derived session and host identity. It never accepts silo,
membership, user, agent authority, or run identifiers as browser-selected trust facts. The private
computer turn path depends on an application-owned run-admission port and a server-only model
transport. This package does not assemble runs, select an execution subject or dispatch tool workloads.

Missing, foreign, closed, access-ended, wrong-mode, duplicate-body, and active-run writes fail
closed through stable denials. The replay persistence port always returns an explicit authorised or
revoked-or-missing outcome from the same snapshot as its rows; it has no rows-only fallback that
could turn authority loss into an empty successful page. Every self-service read and write also
rechecks active organisation membership inside its own database snapshot, so revocation closes
list, open, archive, close, message, and replay authority immediately. Admission overload is
returned as `capacity_limited` rather than being misreported as a persistence outage.

## Dependency direction

Tagged `scope:conversations` at the backend layer, it may use its own scope, the narrow
`scope:history-store` append port, its listed
backend authorities, and shared contracts. The auth edge resolves request identity only. It cannot
import an app, frontend state, or deployment package.

## Data & persistence

Owns participant-facing operations over the `Conversation` and `ConversationParticipant`
projections, the `ConversationPrivatePayload` ciphertext store, and the
`ConversationComputerActiveLease` projection. Ordered history lives in the KurrentDB
`conversation-{id}` stream; PostgreSQL holds no message, run-event, or timeline rows. The write
authority uses serialisable transactions and projects create, archive, and close results from the
same authorised write snapshot. Agent-session turn compilation delegates durable run and input
persistence through its injected admission port after local authority checks. All paths depend on
current active `OrgMembership` in the caller's host-selected silo; participant rows alone never
preserve authority after revocation.

The same encrypted payload table stores accepted model declarations and assistant/tool pairs under
separate deterministic references. These private rows do not append participant history. The turn
stream records the first request at revision 1, tool selection at revision 2 and the second request
at revision 3; its final-answer intent is revision 4, or revision 2 for a direct text answer.

`ConversationComputerAttemptCredential` holds the first key's encrypted custody and actual expiry.
`issueOnce` may recover that key but cannot replace expired or uncertain issuance. `reuseExact`
requires the saved digest and expiry and never creates or renews a key. The original attempt window,
with the existing 300-second ceiling, is separate from each request's at-most-25-second deadline.
Successful revocation clears secrets and retains a non-secret spent-attempt marker without resetting
any budget.

| Credential state | Issuance or reuse | Cleanup |
| --- | --- | --- |
| `pending` | An active claim refuses another issuance; an expired claim cannot mint again. | An expired claim needs alias cleanup because its provider outcome may be unknown. |
| `custodied` | `issueOnce` may finish current-lease promotion of the original key; `reuseExact` refuses. | A failed promotion retains custody until revocation succeeds. |
| `ready` | Return the original key only while its receipt, current lease and authority remain valid. | Revoke the key before clearing encrypted fields. |
| `alias_cleanup` | Neither operation may mint or return a key. | Revoke by alias, then retain `revoked`. |
| `revoking` | Neither operation may mint or return a key. | Retry cleanup of the original custody. |
| `revoked` | Both operations refuse; the attempt is spent. | Repeated cleanup is idempotent. |

The computer-review router keeps sandbox routes and the keyed review credential server-side (the lease id is a public label, never a bearer): file, diff, and
browser discovery require current `Read`, while commands, page creation, screenshots, and preview
access require current `Use`. Those effect routes currently remain denied: their coordinate lookup
uses the read-entitlement port, which rejects effect actions. They need concrete argument-bound
effect admission before execution can be enabled. The group child's reviewed text-sharing path
already has its own transaction-bound admission and is separate from these computer actions.

## Runtime & config

The live history proofs belong to this package and run against an explicitly configured server:

```sh
KURRENTDB_INTEGRATION_URL='kurrentdb://localhost:2113?tls=false' \
  npx nx run backend-server-conversations:test:integration
```

They cover conversation append conflicts and saved-answer recovery through fresh KurrentDB clients,
including a competing event with the same identifier but different content. Without the URL, the
target reports explicit skip markers; that run does not qualify recovery. CI runs these proofs after
the adapter suite against the same pinned KurrentDB service. Neither target starts a local database.

## See also

- Parent index: [server](../../README.md)
- Related authorities: [execution inputs](../../../agents/execution/inputs/main/README.md) ·
  [execution runs](../../../agents/execution/runs/main/README.md)
- Browser consumer: [conversation workspace](../../../../frontend/features/conversation-workspace/README.md)
