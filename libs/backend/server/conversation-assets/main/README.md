# conversation assets — participant file authority

> [OpenCrane](../../../../../README.md) › [backend](../../../README.md) › conversation assets

This package owns participant upload reservations, server-brokered promotion into quarantine,
browser-safe file views, and atomic binding of ready files to canonical messages.

## What it owns

- Ten-file and 200 MiB participant admission enforcement.
- Quarantined revisions and durable scan-job creation.
- Transaction-bound message attachment checks for ordinary chats and agent sessions.
- Browser projections that omit leases, storage coordinates, receipts, and scan evidence.

## Public surface

Import `@opencrane/backend/server/conversation-assets` for the Prisma unit of work and the attachment
factory injected into conversation message admission.

## See also

- [Conversation authority](../conversations/main/README.md)
- [Artifact authority](../agents/artifacts/main/README.md)
- [Shared file policy](../../../../models/conversation-assets/main/README.md)
