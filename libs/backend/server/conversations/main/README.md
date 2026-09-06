# @opencrane/backend/server/conversations — participant conversation authority

> [backend](../../../README.md) › [server](../../README.md) › conversations

## What it owns

This package owns the signed-in participant's conversation API, canonical timeline and authorised
stream transports. It creates conversations in exactly one immutable mode: `agent_session`,
`direct`, or `group`. An agent session binds one agent service; direct and group conversations do
not bind an agent and their ordinary messages never manufacture runs.

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

Attempt-key issuance uses the configured silo authority independently of the Kubernetes namespace.
It commits encrypted custody before a separate ready-state promotion. If promotion and immediate
provider cleanup both fail, the custodied row remains decryptable for a later cleanup or retry.

Before appending assistant history, the turn store records a receipt containing only the already
encrypted payload coordinates and the source command identifier. It also maintains one active-turn
pointer per exact computer lease. If the process restarts between those durable steps and run
completion, the next bootstrap replays the same history event idempotently, completes the fenced run,
revokes its model key, and settles the pointer before another turn can start.

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

The participant history API rechecks current PostgreSQL membership, participation, and central
product authorization before it reads `conversation-{id}`. Text enters a purpose-specific mounted
AES-GCM keyring boundary before PostgreSQL persistence; KurrentDB receives only an opaque payload
reference and ciphertext digest. The response leaves each immutable entry unchanged and returns
separately authorized plaintext in a payload-reference map. A `start` message commits its entry and
checked computer generation to the silo activation queue through one atomic KurrentDB append.
`interrupt` remains denied until a distinct authority can prove and fence the execution it stops.

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
The server rechecks organisation membership and participant bounds on every history page. The
browser polls the same authenticated API after the last observed immutable stream position. A
revoked participant loses both entry access and private payload resolution rather than receiving an
empty successful page.

## Public surface

- `_CreateSelfConversationsRouter` composes the privacy-safe creation directory, participant-bound list, create, message,
  history, archive, and close API over Prisma and KurrentDB. All
  identity and authority coordinates come from the signed-in route and are rechecked transactionally.
- `_SelfConversationsOpenapiPaths` contributes the remaining REST metadata and lifecycle APIs to the
  server-owned OpenAPI document.
- `BoundConversationWriter` is a one-use, stream-bound KurrentDB append boundary for a currently
  leased computer. Its supporting binding, clock, rate-limit, visibility-policy, and lease-fence
  contracts keep the computer unable to select a target stream or stamp a trusted entry coordinate.
- `__RunConversationComputerActivationListener` consumes one silo-scoped, persistent KurrentDB
  activation subscription in delivery order. It validates the stream-bound command before calling
  the computer authority, parks malformed input and an explicitly parked authority outcome,
  acknowledges activated, idempotent, or denied outcomes, waits with bounded exponential backoff
  before retrying a pending sandbox assignment or a transient authority failure, and leaves an
  acknowledgement failure for KurrentDB to redeliver.
- `_CreateConversationComputerOperatorRouter` exposes `POST /conversation-computers/activations/parked:replay`
  for a Principal holding Organization/Administer; it replays the silo's parked activation queue.
- `ConversationComputerLifecycleAuthority` measures idleness from the newest turn activity on the
  lease's active-turn stream (`KurrentConversationComputerActivityReader`), renews an in-use lease at
  half of its lifetime, records an expired or claim-less lease as `lost` with a cold computer, and
  otherwise cools, checkpoints, and releases. Activation opens generation + 1 from `released` or `lost`.
- `ConversationComputerHistory` persists and reloads full computer and lease snapshots on one
  deterministic KurrentDB stream. Its checked current-head result lets future pre-admission code use
  only one matching warm computer with one active, generation-fenced lease.
- `ConversationComputerActiveLease` is the rebuildable PostgreSQL transaction fence for effect and
  approval admission. Activation publishes it only after KurrentDB records the Active lease;
  lifecycle cleanup clears the exact row before recording release or deleting the SandboxClaim.
- `_CreateSelfConversationHistoryRouter` exposes exclusive-cursor KurrentDB reads and encrypted
  participant message admission without a relational transcript fallback.
- `PrismaSelfConversationHistoryUnitOfWork` joins current PostgreSQL authorization and encrypted private
  payload persistence to checked KurrentDB operations.
- `PrismaConversationComputerTurnUnitOfWork` rechecks the pending human author's current authority
  before handing server-derived lease, identity, revision, and requester coordinates to the injected
  run-admission port. It accepts compiled input only for the deterministic first attempt.
- `KurrentConversationHistoryAdmissionReader` re-reads one exact stream revision and returns its
  completed message order plus the immutable final human author to durable run admission.
- `PrismaKurrentConversationPromptMessageRepository` resolves that admitted message set through
  conversation-bound encrypted payload rows. It verifies the silo, conversation, payload reference,
  author and ciphertext digest before decrypting, and has no relational transcript fallback.

## Boundary

The self API receives only server-derived session and host identity. It never accepts silo,
membership, user, agent authority, or run identifiers as browser-selected trust facts. The private
computer turn path depends on a narrow application-owned admission port; this package does not
persist runs, select an execution subject, dispatch workloads, or execute agents. The channel replay route separately
requires a consumed one-use context and the exact controller-selected route identifier.

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

The computer-review router keeps sandbox routes and the keyed review credential server-side (the lease id is a public label, never a bearer): file, diff, and
browser discovery require current `Read`, while commands, page creation, screenshots, and preview
access require current `Use`.

## See also

- Parent index: [server](../../README.md)
- Related authorities: [execution inputs](../../../agents/execution/inputs/main/README.md) ·
  [execution runs](../../../agents/execution/runs/main/README.md) · [channel-targets](../../agents/channel-targets/main/README.md)
- Browser consumer: [conversation workspace](../../../../frontend/features/conversation-workspace/README.md)
