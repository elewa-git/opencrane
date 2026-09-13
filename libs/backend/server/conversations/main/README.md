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
| `memory/commands/` | Validate explicit Remember, Correct and Forget requests without accepting plaintext or caller-supplied authority. |
| `memory/source/` | Read the selected human message through current history access and recheck its encrypted source inside the command transaction. |
| `memory/workflow/` | Declare identifier-only memory tasks; the command transaction must retain Absurd's returned receipt. Product command integration is in progress. |
| `children/` | Admit group-child work, preserve its original audience, recover creation, and share human-reviewed text. |
| `computers/` | Separate activation, lifecycle, checkpoint, turn and review operation owners. |
| `computers/tools/` | Proposal admission, current dispatch access and saved result consumption each have their own owner. |
| `computers/interruptions/` | Select and admit requester-owned Stop commands, record their outcome and let Absurd recover cancellation cleanup. |
| `computers/turns/workflow/` | Absurd task admission, saved run receipt binding, durable waits and terminal tool-result wakeups. |
| `computers/turns/approval-notifications/` | Recheck the assigned participant and publish one receipt-backed requested-approval history fact before the durable wait. |
| `computers/turns/tool-result-notifications/` | Publish a terminal tool status and its private recovery receipt before the remaining model call is reserved. |
| `computers/turns/credentials/` | Credential issuance, exact recovery and cleanup use repositories supplied by the credential unit of work. |
| `authorization/` | Transaction-bound product permission and membership checks. |
| `http/` | Public OpenAPI descriptions. |

## Public surface

- `PrismaConversationMetadataUnitOfWork` and `_CreateConversationMetadataRouter` compose directory, list, create, archive and close operations. `PrismaConversationMetadataReader` supplies review coordinates without exposing creation.
- `PrismaAgentSessionCreationUnitOfWork` creates or recovers a personal assistant conversation from its caller-scoped UUID.
- `PrismaSelfConversationHistoryUnitOfWork` and `_CreateSelfConversationHistoryRouter` bind current access to messages, history and event streams. `PrismaConversationMessageAdmissionUnitOfWork` commits the encrypted payload and delegates selected-asset binding through a transaction-scoped `ConversationMessageAttachmentAdmissionFactory` before KurrentDB append.
- `PrismaConversationPromptDocumentPreparationUnitOfWork` reads the exact Kurrent history prefix,
  resolves selected PDFs through `ConversationPromptDocumentAuthority`, and verifies their converted
  bytes outside SQL. Initial and restarted compilation repeat the current authority and coordinate
  checks before adding the text as untrusted user content.
- `PrismaGroupChildAuthority`, `_CreateGroupChildRouter` and `GROUP_CHILD_TASK` compose explicit child requests and recovery.
- `PERSONAL_MEMORY_OPERATION_TASK` and `_CreatePersonalMemoryOperationTask` share identifier-only
  memory task admission. Absurd assigns the task ID; command composition must save its returned
  receipt and the memory operation in one transaction. The task declaration alone does not admit
  work or make Remember, Correct or Forget available through the product.
- `PrismaKurrentPersonalMemoryMessageSource` reads one selected, completed human message authored
  by the caller. It requires one non-empty text block, limits its UTF-8 content to 64 KiB, and keeps
  decrypted text outside the SQL transaction. `PrismaPersonalMemoryMessageSourceRepository`
  rechecks current read access, the visible position and the encrypted payload coordinates in the
  caller's transaction. Later conversation entries do not invalidate an unchanged selected message.
- Computer activation atomically admits the existing Absurd turn task when it publishes an active lease. The workflow advances saved model, tool-result, continuation and completion state; the only Pod-facing turn route returns its lease-derived review credential.
- Stop handling reloads the immutable causation message to derive its requester and never enters activation. Its Kurrent publisher gives final output and cancellation one checked turn-stream winner; cancellation commits the private receipt, safe interrupted log and active-turn settlement together.
- A fresh Stop selection checks current requester access before Kurrent records its target or no-target
  outcome. Target admission then rechecks current SQL authority and binds one Absurd cancellation task. That task
  records the Kurrent winner, cancels the original turn task, revokes model credentials and waits
  for provider claims before finalizing. Missing relational lease coordinates fail closed; a
  no-target receipt is written only when an existing exact lease names the checked pointer stream.
- Lifecycle, checkpoint, turn and review authorities, routers and adapter ports support server composition. The activation worker receives a process logger and an explicit exhaustion callback.
- `ConversationComputerTurnAuthority` owns the final output-authority recheck, the turn store owns the atomic receipt-and-answer commit, and `ConversationComputerTurnWriterFactory` prepares and exactly confirms that answer. The activation and lifecycle units of work own their transaction isolation.
- `PrismaCompanyAssistantDirectory`, `PrismaGroupChildAgentResolver`, `_ResolveConversationCaller` and `_RegisterGroupChildWorkflow` bind current identity and recovery to participant operation owners.
- `_SelfConversationHistoryOpenapiPaths` contributes the conversation API description.

History and computer snapshot classes are imported directly from their sibling packages.

### Stop selection and recovery

Each Stop command has a private Kurrent stream. Its first event fixes the selected turn or records
that there was no eligible turn. The append also checks the observed active-turn pointer, so two
deliveries cannot commit different selections. Recording a target does not yet cancel work or admit
a task: the following SQL transaction must recheck the requester, lease, generation, run attempt
and original task before saving `Cancelling` and the Absurd task together.

| Saved command state | Next event or observation | Result |
| --- | --- | --- |
| No command event | Authorized reader finds a target and the observed pointer still matches | Append target selection at revision 0. |
| No command event | Authorized reader finds no eligible target and the observed pointer still matches | Append the terminal no-target receipt at revision 0; admit no task. |
| No command event | Another delivery or turn changes a checked stream | Reload the saved selection, or resolve again if no delivery selected yet. |
| Target selected at revision 0; no SQL admission | First delivery or restart | Recheck authority and admit only that saved target. Never select a newer turn. |
| Target selected; SQL admission is denied | Run already ended or current authority no longer permits Stop | Return a permanent refusal to the activation consumer. No cancellation state or task commits. |
| Target selected; SQL admission exists | Delivery or task retry | Recover the saved cancellation task and arbitrate against output for the same turn. |
| Target selected; final output wins | Absurd observes the committed answer | Append an output-won receipt at revision 1; complete the SQL run successfully without cancellation cleanup. |
| Target selected; cancellation wins | Absurd commits cancellation against the turn revision | Append the cancellation receipt at revision 1 together with the interrupted log and active-turn settlement, then perform cleanup. |
| Terminal receipt exists | Redelivery or restart | Reuse the recorded outcome; resume any admitted cleanup without another model request or allowance. |

Kurrent owns the selection and final-output race. SQL owns current authorization and atomic task/run
admission. Absurd owns retries and cleanup after admission. A selected target whose SQL admission
was denied remains bound to that command; it cannot be reused to stop a later turn.

## Boundary

The browser never selects trusted silo, membership, principal, agent or run authority. Every read
rechecks active organisation membership and participant bounds; child reads also require continuing
parent access. Revocation cannot become an empty successful history response.

Creation retries preserve the original member set, current grants and lifecycle. Message retries
bind the UUID conversation-wide to the same author, plaintext, canonical asset set, immutable content
blocks and activation. A changed retry rolls back its admission and attachment writes. Text may be
empty only when the command binds at least one selected asset.
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
MCP assignment checks receive the saved execution Principal: the human for a personal run or the
managed service for a company run. The MCP owner checks that Principal's current installation; a
requester's or administrator's connection cannot substitute for it.

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
