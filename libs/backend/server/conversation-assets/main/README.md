# @opencrane/backend/server/conversation-assets — conversation file authority

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › conversation assets

## What it owns

This package owns participant upload reservations, retry-stable agent-output tickets,
server-authorized reservation removal, server-brokered promotion into quarantine, participant-
authorized reads of checked bytes, browser-safe file views, and atomic binding of ready files to canonical messages. It applies the
ten-file/200 MiB admission rule, creates quarantined revisions and scan jobs, and checks attachment
readiness inside ordinary-chat and agent-session message transactions.

```text
 file selection -> upload reservation -> quarantine + scan -> ready -> message attachment
 agent runtime -> output ticket -> quarantine + scan -> ready agent output
 active participant -> ready asset -> private byte broker -> preview or download
```

In this flow: the [artifact authority](../../agents/artifacts/main/README.md) owns scanning and
publication, while the [conversation authority](../../conversations/main/README.md) owns messages.

## Public surface

Import `@opencrane/backend/server/conversation-assets` for the participant and agent-output Prisma
units of work, the private runtime output router, and the attachment factory injected into
conversation message admission.

## Boundary

Browser projections omit leases, storage coordinates, receipts, and scan evidence. This package
does not scan bytes or publish revisions; it delegates byte promotion through an app-owned broker
and accepts only the artifact authority's durable ready state during message admission.

Every preview or download reloads active organisation membership, current conversation
participation, the ready asset, and its exact published revision. The server consumes a short-lived
read lease itself and streams the checked bytes with a safe inline-or-attachment header; neither the
lease nor the storage address reaches the browser.

Agent output requires the exact registered runtime pod, run attempt, and unique persisted assistant
`message.started` event on every reserve and finalize operation. The runtime supplies its stable
message id; the server resolves the database sequence and never trusts a caller-supplied sequence. A retry may reuse a ticket only
with identical metadata and expected content. The runtime streams bytes through the private server
broker; only a verified ArtifactStore receipt can create the quarantined revision and scan job.
Ticket identity and its verified receipt are database-immutable, and a composite foreign key keeps
every linked asset on the exact same silo, conversation, run, attempt, event, and message.
When the scanner is not configured, both participant and runtime output admission return
`scanner_unavailable` before a reservation or byte promotion begins. Existing Ready files remain
readable; the server never accepts new work that would remain indefinitely in Processing.

Processing, ready, and failed transitions append a payload-free `conversation.assets.changed`
System timeline entry while the conversation is open. The ordinary authorized replay stream carries
that invalidation; clients then reread the safe asset list instead of receiving storage or scan data.
The scanner integration opens one transaction and constructs both the artifact scan repository and
this package's output-lifecycle repository with that same transaction binding. Artifact code decides
scan publication; conversation-assets code remains the sole owner of ConversationAsset and timeline
mutations.

Each projection includes caller-specific `canRemove` capability. Removal is limited
to the creating participant's unlinked, not-yet-uploaded reservation; it revokes the write lease,
queues the artifact for deletion, and returns a sanitized tombstone. Linked history, uploaded bytes,
and assistant-created output cannot be removed through this command.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:backend`, it may depend on conversations, artifacts,
execution-run references, shared contracts, and the pure conversation-file policy. Apps compose it;
frontend and unrelated server domains do not import its persistence adapters.

## Data & persistence

Owns `ConversationAsset` and `ConversationAssetOutputTicket` in
`apps/opencrane/prisma/schema/conversation-assets.prisma`. Output tickets are structurally tied to
their `WorkloadAssignment` and `ConversationRunEvent`; finalization stores the content and receipt
proof exactly once. The package creates the quarantined `ArtifactRevision` and `ArtifactScanJob`
through the artifact domain's reviewed schema and transaction contract rather than taking ownership
of those models.

## See also

- [Conversation authority](../../conversations/main/README.md)
- [Artifact authority](../../agents/artifacts/main/README.md)
- [Shared file policy](../../../../models/conversation-assets/main/README.md)
