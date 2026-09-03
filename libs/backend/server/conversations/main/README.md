# @opencrane/backend/server/conversations — participant conversation authority

> [backend](../../../README.md) › [server](../../README.md) › conversations

## What it owns

This package owns the signed-in participant's conversation API, canonical timeline and authorised
stream transports. It creates conversations in exactly one immutable mode: `agent_session`,
`direct`, or `group`. An agent session binds one agent service; direct and group conversations do
not bind an agent and their ordinary messages never manufacture runs.

```
 authenticated participant
          │ directory · list · create · open · message · retry run · archive · close · replay
          ▼
 ┌──────────────────────────────────────────┐
 │ conversations  ◄── HERE                   │
 │ immutable mode · participant coordinates │
 │ atomic admission · authorised event read │
 └──────────────────────────────────────────┘
          │ agent-session message       │ direct/group message
          ▼                             ▼
 execution/admission              canonical message only
```

**In this flow:** [execution admission](../../../agents/execution/admission/main/README.md) ·
[channel-proxy](../../../channel-proxy/main/README.md) ·
[conversation projection](../../../conversations/projection/main/README.md) ·
[AG-UI browser state](../../../../frontend/state/conversation/ag-ui/README.md)

Message admission dispatches through the persisted mode strategy. A direct or group message commits
as a canonical message without an `AgentRun`. An agent-session message enters the internal personal
run-admission port so the message, immutable input snapshot, run, and first dispatch intent commit in
one transaction. A single active foreground run blocks another agent-session message. The public API
does not expose a separate run-start route.

The general conversation unit of work owns participant reads and aggregate lifecycle writes. A
dedicated message-admission unit owns submission routing, retry recovery, denial translation, and
the handoff into execution admission's authoritative final transaction. Conversation composition
supplies the route facts and the required execution-inputs compiler. The runs package then checks
replay, requester, run, and service authority, requires its compiler to recheck the next attempt's
AgentIdentity, membership, capability decision, and computer lease, and commits its
immutable snapshot through the same serializable compare-and-swap. Browser requester coordinates
identify the request and never substitute for execution authority.

`BoundConversationWriter` is the KurrentDB-facing computer boundary. A caller mints one binding for
one silo, conversation, computer lease generation, agent identity, run, and expected stream
revision; the writer then stamps its agent author, stream position, timestamp, and Kurrent event
metadata before one append. It accepts only opaque participant-entry references, checks the
requested audience through a current visibility policy, rejects an attestation from the computer,
enforces a byte and rate budget, rechecks the active lease before each physical append, and cannot
read history, select a different stream, or append a second distinct entry. A response-lost retry
reuses the originally stamped source command and entry bytes. It remains uncomposed until the direct KurrentDB
conversation-authority replacement can delete the relational writer in the same slice.

`ConversationComputerHistory` owns the separate deterministic KurrentDB stream for the logical
computer itself. It accepts complete, closed computer and lease snapshots only through the narrow
HistoryStore port, checks their stream revision on every append, and replays them against the current
head before returning state. A later pre-admission composition can ask it only for the exact silo,
conversation, AgentIdentity and profile it already selected; it receives an active lease only when
the matching computer is currently warm. A missing, retired, cooling, released, lost, malformed, or
cross-coordinate snapshot fails closed. This history authority does not create a sandbox claim,
activate a sandbox, use PostgreSQL, or receive a direct KurrentDB client.

`ConversationComputerExecutionAuthority` is the next boundary after a sandbox claim becomes ready.
It starts the loop only by appending one server-generated execution to the computer's warm active
lease. If a caller loses the response while another server process wins the append race, it reloads
and returns that stored execution instead of starting another one. A sandbox never creates or picks
this execution: it must remain unavailable whenever the computer is cold, cooling, expired, replaced,
or already terminal.

Before creation, the directory returns active organisation members as opaque membership references.
It never returns login subjects, email addresses, roles, or personal-memory identity. It also
projects the caller's active personal Agent only when exactly one service matches their approved
persona; no match is unavailable and more than one match is ambiguous, so the server never silently
chooses an Agent.

The directory and create transaction also use the central product catalogue. Selected membership
references require exact `OrganizationMembership/Read`; an agent target requires
`AgentService/Read` and admitted `AgentService/Invoke`, while the approved persona requires admitted
`Persona/Use`. The create itself consumes the silo's typed `ConversationCollection/Create` grant.
The same transaction writes participant grants for Discover, Read, Edit and Use, plus Delete only
for the new conversation's creator. Existing conversations without trustworthy creator provenance
remain fail-closed for Delete after migration.

Every conversation read and mutation evaluates the caller's current Principal plus direct stored
Group memberships through `AuthorizationAuthority`. A direct Principal grant and an inherited Group
grant therefore receive the same decision semantics, including deny precedence, expiry, and
revocation. `ConversationParticipant` remains a lifecycle and projection coordinate: both grant
forms still require current participation so visible timeline bounds, archive state, unread state,
and ended access cannot be bypassed by authorization alone.

Participant artifact blocks are delegated to the conversation-assets attachment port inside that
same ordinary-message or run-admission transaction. Any foreign, unchecked, reused, or oversized
asset rolls the message back instead of leaving a dangling transcript reference.

Archive and close are deliberately different. Archive is reversible and affects only one
participant's list. Close is permanent, applies to the conversation, and makes it read-only. Each
participant separately records the first visible position, the last read position, and an optional
access-ended position; reads are clipped to those bounds and writes require continuing access.
Opening a child Agent-thread returns exact unread message count separately from timeline positions.
The participant may then advance `readThroughPosition` through the exact parent-child route. That
mutation is monotonic and idempotent, rechecks current parent and child access, and refuses any
position beyond the current canonical child timeline.

The database allocates one monotonically increasing position across message and run-event timeline
entries. Timeline entries hold typed references to canonical rows, never copied payloads. The replay
repository checks membership and participant bounds and reads those linked rows in one repeatable
snapshot. It hands the result to the separate
[conversation projection package](../../../conversations/projection/main/README.md), which owns
redaction, Agent User Interface (AG-UI) mapping, cursors and live streaming for every mode.
Safe technical failure classifications remain visible there, including when a later attempt retries
the tool, while credentials and provider details are never exposed.

The server rechecks organisation membership and participant bounds on every page. The public
browser transport is one same-origin WebSocket: it restores the signed-in cookie session during the
upgrade, rejects a mismatched origin, replays the canonical timeline as structured frames, and
accepts only idempotent participant-message commands. Projection pauses when a peer is congested
and rechecks access before every replay page, so revocation closes the socket instead of becoming an
empty successful stream. The separate internal replay route remains a one-use channel-context
transport for workloads; it is not a browser fallback.

## Public surface

- `_CreateSelfConversationsRouter` composes the privacy-safe creation directory, participant-bound list, create, open, message,
  Agent-thread mark-read, failed-run retry, archive, and close API over Prisma and the internal
  execution ports. Retry accepts only the observed terminal attempt; all
  identity and authority coordinates come from the signed-in route and are rechecked transactionally.
- `_CreateConversationReplayRepository` composes replay over one `RepeatableRead` transaction so
  access-ending races cannot expose later events.
- `__CreateConversationReplayRouter` mounts internal context-authorized AG-UI snapshot-to-live replay.
- `_CreatePrismaSelfConversationSocketServer` composes the signed-in participant WebSocket from the
  same message authority and replay repository as the REST conversation metadata API.
- `_SelfConversationsOpenapiPaths` contributes the remaining REST metadata and lifecycle APIs to the
  server-owned OpenAPI document.
- `BoundConversationWriter` is a one-use, stream-bound KurrentDB append boundary for a currently
  leased computer. Its supporting binding, clock, rate-limit, visibility-policy, and lease-fence
  contracts keep the computer unable to select a target stream or stamp a trusted entry coordinate.
- `__RunConversationComputerActivationListener` consumes one silo-scoped, persistent KurrentDB
  activation subscription in delivery order. It validates the stream-bound command before calling
  the computer authority, parks malformed input and an explicitly parked authority outcome,
  acknowledges activated, idempotent, or denied outcomes, retries only a transient authority
  failure, and leaves an acknowledgement failure for KurrentDB to redeliver.
- `ConversationComputerActivationClaimAuthority` derives the immutable profile, identity, and
  pending lease from checked computer history before it creates one deterministic Agent Sandbox
  claim. It parks a profile, lease, or receipt mismatch before that mismatch can become a second
  computer realization; it does not authorize an agent.
- `ConversationComputerSandboxReconciliationAuthority` replays an activation locator against
  current computer history and the exact immutable claim status. `Ready=True` becomes the active
  lease; an expired dispatch becomes `RecoveryRequired` with a lost lease. It never manages a Pod,
  writes Agent Sandbox status, or accepts a status from a foreign claim.
- `ConversationComputerHistory` persists and reloads full computer and lease snapshots on one
  deterministic KurrentDB stream. `loadActiveExecution` returns only an open execution whose
  identity and lease generation match the checked current head, so a later command authority can
  fence its participant append to the active loop attempt.
- `__CreateConversationComputerRuntimeBootstrapRouter` admits one Sandbox bootstrap only after
  TokenReview confirms its projected Pod identity and that identity matches the active lease stored
  in `ConversationComputerHistory`. The Sandbox supplies only its computer id; the route derives the
  conversation and execution from checked history and does not disclose inactive or foreign computers.
- `ConversationComputerExecutionAuthority` appends the sole server-generated execution for a warm,
  active, unexpired computer lease. It returns the stored execution after a concurrent append race,
  but returns unavailable rather than allowing a sandbox to begin work on a cold, expired, replaced,
  or terminal computer.
- `ConversationHistoryReader.readCurrent` replays every participant-visible entry from the
  immutable first position and returns only the KurrentDB head condition that a later atomic
  command append may use. It does not authorize a participant or append an entry itself.
- `ConversationComputerRuntimeInputElicitationAuthority` derives the computer execution, AgentIdentity,
  participant, expiry, and entry coordinates server-side, records `Conversation/Use`, and makes one
  atomic KurrentDB RuntimeInput request append fenced by computer, conversation, and identity heads.
  An identical response-lost retry returns the first durable receipt without re-admitting or appending;
  a changed reuse of the same request identifier fails closed. The authority is intentionally exported
  but not yet composed: the #759 ConversationComputer loop checkpoint owns that composition.
- `ConversationComputerElicitationResolutionAuthority` accepts only an authenticated caller,
  conversation, request identifier, retry identifier, and typed answer or decline. It derives the
  addressed participant, records `Conversation/Use`, checks the request's current computer and
  AgentIdentity heads, and appends the sole terminal entry atomically. Its protected payload port
  digest-checks the request and validates and stores the response outside conversation history. It is
  intentionally uncomposed until the replacement participant interrupt transport is ready; it never
  resumes a legacy workflow or falls back to the Prisma elicitation authority.
- `ConversationComputerElicitationInterruptReader` restores only unresolved, unexpired target
  elicitation requests addressed to the authenticated participant and fenced to the app-derived
  current computer execution and lease. Its protected-payload port must verify request ownership
  and digest before it supplies a browser-safe prompt and response schema. The reader uses
  `computerExecutionId` as the opaque AG-UI wait correlation because a target ConversationComputer
  deliberately does not retain a legacy `AgentRun` identifier. It remains uncomposed until the
  protected payload store and target participant router replace the legacy elicitation transport
  together.

## Boundary

The self API receives only server-derived session and host identity. It never accepts silo,
membership, user, agent authority, or run identifiers as browser-selected trust facts. It creates a
run only by calling the internal execution-admission port for an eligible agent-session message; it
does not assemble inputs, dispatch workloads, or execute agents. The channel replay route separately
requires a consumed one-use context and the exact controller-selected route identifier.

Missing, foreign, closed, access-ended, wrong-mode, duplicate-body, and active-run writes fail
closed through stable denials. The replay persistence port always returns an explicit authorised or
revoked-or-missing outcome from the same snapshot as its rows; it has no rows-only fallback that
could turn authority loss into an empty successful page. Every self-service read and write also
rechecks active organisation membership inside its own database snapshot, so revocation closes
list, open, retry, archive, close, message, and replay authority immediately. Admission overload is
returned as `capacity_limited` rather than being misreported as a persistence outage.

## Dependency direction

Tagged `scope:conversations` at the backend layer, it may use its own scope, the narrow
`scope:conversation-projection` engine, the narrow `scope:history-store` append port, its listed
backend authorities, and shared contracts. The auth edge resolves request identity only. It cannot
import an app, frontend state, or deployment package.

## Data & persistence

Owns participant-facing operations over `Conversation`, `ConversationParticipant`,
`ConversationMessage`, and `ConversationTimelineEntry`. The write authority uses serialisable
transactions and projects create, archive, and close results from the same authorised write
snapshot. Message admission separately uses serialisable ordinary-message writes and binds agent
messages to execution admission's final transaction. The replay adapter is read-only and joins
timeline references to canonical messages and `RunEvent`; neither path
reconstructs order from client or run timestamps. All paths depend on current active `OrgMembership`
in the caller's host-selected silo; participant rows alone never preserve authority after revocation.

## See also

- Parent index: [server](../../README.md)
- Related authority: [execution admission](../../../agents/execution/admission/main/README.md) ·
  [channel-targets](../../agents/channel-targets/main/README.md)
- Stream engine: [conversation projection](../../../conversations/projection/main/README.md)
- Browser consumer: [AG-UI state](../../../../frontend/state/conversation/ag-ui/README.md)
