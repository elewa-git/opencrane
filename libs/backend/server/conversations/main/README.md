# @opencrane/backend/server/conversations — participant conversation authority

> [backend](../../../README.md) › [server](../../README.md) › [conversations](../README.md) › main

## What it owns

This package owns signed-in participant conversation operations and coordinates assistant computers.
Direct and group conversations hold ordinary messages; an agent session binds an assistant service.
PostgreSQL checks current membership, grants and participation. KurrentDB owns ordered history.

1. Resolve the caller from the signed-in session and host-selected organisation.
2. Check current membership, participant bounds and central product authorisation.
3. Commit transaction-bound decisions and ciphertext; delegate checked history writes to `history`.
4. Activate an assistant computer only through the admitted message's atomic activation request.

```text
signed-in participant ──► main ◄── HERE ──► history
                          │                encrypted ordered entries
                          ├──► computers   checked computer/lease snapshots
                          └──► PostgreSQL  permissions and projections
```

**In this flow:** [participant history](../history/README.md) · [computer history](../computers/README.md)
· [PostgreSQL](../../../../../apps/postgres/README.md).

| Source owner | Responsibility |
| --- | --- |
| `metadata/` | Directory, reads, creation and participant lifecycle each own their queries and transaction sequencing. The metadata facade only delegates. |
| `sessions/` | Establish personal-session history and its recoverable projection without reopening retries. |
| `messages/` | Authorise, encrypt and admit participant messages; read authorised history and stream events. |
| `children/` | Admit group-child work, preserve its original audience, recover creation, and share human-reviewed text. |
| `computers/` | Separate activation, lifecycle, checkpoint, turn and review operation owners. |
| `computers/tools/` | Proposal admission, current dispatch access and saved result consumption each have their own owner. |
| `computers/turns/workflow/` | Absurd task admission, saved run receipt binding, durable waits and terminal tool-result wakeups. |
| `computers/turns/approval-notifications/` | Recheck the assigned participant and publish one receipt-backed requested-approval history fact before the durable wait. |
| `computers/turns/tool-result-notifications/` | Publish a terminal tool status and its private recovery receipt before the remaining model call is reserved. |
| `computers/turns/credentials/` | Credential issuance, exact recovery and cleanup use repositories supplied by the credential unit of work. |
| `authorization/` | Transaction-bound product permission and membership checks. |
| `http/` | Public OpenAPI descriptions. |

## Public surface

- `PrismaConversationMetadataUnitOfWork` and `_CreateConversationMetadataRouter` compose directory, list, create, archive and close operations. `PrismaConversationMetadataReader` supplies review coordinates without exposing creation.
- `PrismaAgentSessionCreationUnitOfWork` creates or recovers a personal assistant conversation from its caller-scoped UUID.
- `PrismaSelfConversationHistoryUnitOfWork` and `_CreateSelfConversationHistoryRouter` bind current access to messages, history and event streams.
- `PrismaGroupChildAuthority`, `_CreateGroupChildRouter` and `GROUP_CHILD_TASK` compose explicit child requests and recovery.
- Computer activation atomically admits the existing Absurd turn task when it publishes an active lease. The workflow advances saved model, tool-result, continuation and completion state; the only Pod-facing turn route returns its lease-derived review credential.
- Lifecycle, checkpoint, turn and review authorities, routers and adapter ports support server composition. The activation worker receives a process logger and an explicit exhaustion callback.
- `ConversationComputerTurnAuthority` owns the final output-authority recheck, the turn store owns the atomic receipt-and-answer commit, and `ConversationComputerTurnWriterFactory` prepares and exactly confirms that answer. The activation and lifecycle units of work own their transaction isolation.
- `PrismaCompanyAssistantDirectory`, `PrismaGroupChildAgentResolver`, `_ResolveConversationCaller` and `_RegisterGroupChildWorkflow` bind current identity and recovery to participant operation owners.
- `_SelfConversationHistoryOpenapiPaths` contributes the conversation API description.

History and computer snapshot classes are imported directly from their sibling packages.

## Boundary

The browser never selects trusted silo, membership, principal, agent or run authority. Every read
rechecks active organisation membership and participant bounds; child reads also require continuing
parent access. Revocation cannot become an empty successful history response.

Creation retries preserve the original member set, current grants and lifecycle. Message retries
bind the UUID to the same plaintext and activation; a changed-text retry rolls back its admission.
Ordinary group messages never start runs. Shared child work keeps the originally admitted audience
and company identity, and returns text to the parent only through an explicit human sharing action.

Archive changes one participant's list and is reversible. Close permanently makes the conversation
read-only. Computer review reads require current Read permission; interactive effects remain denied
until concrete argument-bound Use admission exists. Computer turns delegate run admission through
an injected port. Their Absurd workflow binds its receipt to the admitted run before any model or
tool effect, and every server effect rejects a changed frozen input, stale lease or stale generation.

## Tool and answer authority

A proposal keeps one invocation slot for its admitted run attempt. Its transaction reads the saved
run and snapshot, records central permission evidence, checks current dispatch access and admits
executor work together. A refusal after any write rolls back the whole transaction. Identical
retries recover the original winning invocation; they never replace it with fresh evidence.

Dispatch access is checked during proposal preparation, executor claim and terminal result use.
The dispatch coordinator delegates saved run and budget evidence, current computer identity and
conversation access to their owners. It does not decide the invocation lifecycle; central IAM owns
those state transitions. A terminal result remains readable only while its original authority holds.

After encrypted continuation custody accepts the exact result, the turn publishes one content-free
tool log before it reserves the second model call. A private revision-zero receipt binds the saved
invocation, terminal outcome and result digest to that conversation entry. The participant log keeps
the frozen tool name, public invocation identity and completed or failed phase, along with the author,
time, visibility and identifiers required by conversation history. It never carries arguments, result
content, result digests, credentials or provider metadata. Receipt recovery is idempotent; a new
physical append repeats current result, run, conversation and lease checks.

Approval-gated personal proposals preserve the frozen arguments, schema and run allowance in the
existing invocation slot, then pause the run in `WaitingForInput` through deferred IAM approval.
Only the exact current run owner may answer its elicitation. Approval marks the invocation ready and
wakes the saved Absurd turn task; denial, expiry or stale authority produces no MCP dispatch and
wakes the same continuation to record the terminal outcome. Managed company approval tools remain
unavailable at model selection and proposal preparation until an entitled human resolver is bound.

Before waiting, the Absurd turn checkpoints a participant-subset approval log. Its fixed summary and
action reveal no tool target, arguments, schema, purpose payload or credential. A revision-zero
Kurrent receipt commits atomically with the conversation entry, so restart recovery confirms the
same event rather than publishing a duplicate. Current owned-elicitation and Conversation Read
checks suppress a new append after expiry or revocation; ordinary history authorization still
controls later replay and live delivery.

The turn store atomically commits the exact answer receipt and participant-visible history event. Absurd
owns durable deadlines, waits, restart recovery and selection of the next saved step. A new
physical append rechecks the workload lease, generation, Pod, history position, selected result digest and authority deadline through
`__AssertConversationComputerAnswerAuthority`. An already accepted matching history entry can be
recovered after later authority loss. Provider credentials are issued after their reservation commits;
exact retries reuse the saved receipt and failed cleanup prevents a replacement key.

## Dependency direction

Tagged `type:lib`, `layer:backend`, `scope:conversations`. Main uses the sibling history libraries,
listed backend authorities and shared contracts. It never imports an app or frontend implementation.

## Data & persistence

Owns operations over `Conversation`, `ConversationParticipant`, `ConversationPrivatePayload` and
`ConversationComputerActiveLease` projections. PostgreSQL holds grants, membership and admission
evidence; KurrentDB owns conversation and computer history. Ciphertext is stored before its opaque
reference is appended. Serializable writes retain their existing retry and conflict semantics.

Run `nx run backend-server-conversations:test:integration` with `KURRENTDB_INTEGRATION_URL` to
exercise approval, tool-result and answer recovery against a real history server. Ordinary package
tests use controlled ports.

## See also

- [Conversations](../README.md) · [History](../history/README.md) · [Computers](../computers/README.md)
- [Execution inputs](../../../agents/execution/inputs/main/README.md) · [Execution runs](../../../agents/execution/runs/main/README.md)
