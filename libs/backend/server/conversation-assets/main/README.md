# @opencrane/backend/server/conversation-assets — participant file authority

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › conversation assets

## What it owns

This package owns participant upload reservations, server-authorized reservation removal,
server-brokered promotion into quarantine, browser-safe file views, and atomic binding of ready
files to canonical messages. It applies the
ten-file/200 MiB admission rule, creates quarantined revisions and scan jobs, and checks attachment
readiness inside ordinary-chat and agent-session message transactions.

```text
 file selection -> upload reservation -> quarantine + scan -> ready -> message attachment
```

In this flow: the [artifact authority](../../agents/artifacts/main/README.md) owns scanning and
publication, while the [conversation authority](../../conversations/main/README.md) owns messages.

## Public surface

Import `@opencrane/backend/server/conversation-assets` for the Prisma unit of work and the attachment
factory injected into conversation message admission.

## Boundary

Browser projections omit leases, storage coordinates, receipts, and scan evidence. This package
does not scan bytes or publish revisions; it delegates byte promotion through an app-owned broker
and accepts only the artifact authority's durable ready state during message admission.

Each projection includes caller-specific `canRemove` and `canRetry` capabilities. Removal is limited
to the creating participant's unlinked, not-yet-uploaded reservation; it revokes the write lease,
queues the artifact for deletion, and returns a sanitized tombstone. Linked history, uploaded bytes,
and assistant-created output cannot be removed through this command.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:backend`, it may depend on conversations, artifacts,
execution-run references, shared contracts, and the pure conversation-file policy. Apps compose it;
frontend and unrelated server domains do not import its persistence adapters.

## Data & persistence

Owns `ConversationAsset` in `apps/opencrane/prisma/schema/conversations.prisma`. It creates the
quarantined `ArtifactRevision` and `ArtifactScanJob` through the artifact domain's reviewed schema
and transaction contract rather than taking ownership of those models.

## See also

- [Conversation authority](../../conversations/main/README.md)
- [Artifact authority](../../agents/artifacts/main/README.md)
- [Shared file policy](../../../../models/conversation-assets/main/README.md)
