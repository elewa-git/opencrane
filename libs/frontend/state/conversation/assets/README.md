# @opencrane/state/conversation/assets — governed conversation file state

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../adapter/README.md) › assets

## What it owns

This package owns one mounted conversation's browser-safe file projection, checked-byte reads, and exact upload intents.
It validates the complete ten-file, 200 MiB message selection before starting work, computes the
content digest locally, reuses the same idempotency key and bytes after a transport failure, and
adopts only the server's returned lifecycle.

The live gateway uses the generated Control Plane client. It never receives storage URLs, leases,
receipts, scanner evidence, or credentials.

## Public surface

- `ConversationAssetsStore` — component-scoped read resource, independent upload admission, retry,
  local pre-admission removal, and removal of exact reservations granted by server capability.
- `ConversationAssetContentStore` — component-scoped Ready-file reads with per-asset duplicate,
  metadata, selection, and access-loss fences. It returns Blob bytes to its immediate caller and
  never retains them in reactive state.
- `CONVERSATION_ASSETS_GATEWAY` and `ConversationAssetsGateway` — narrow transport port.
- `OpenCraneConversationAssetsGateway` — generated-client adapter.
- `ConversationAssetsGateway.read` — participant-bound byte read that returns a browser `Blob` and never a storage URL.
- Browser-safe asset, pending-upload progress, typed selection-error, and server capability types.

## Boundary

The package prepares files and reflects durable server state; it does not attach an unchecked file
to a message. Message admission remains a server transaction and accepts only assets whose current
authoritative state is ready.
Preview and download bytes come only from the participant API, which rechecks access and ready state
for each read. This state package never receives a storage address, lease, or scanner evidence.
The content store also reuses the model-owned media disposition policy: response Blob metadata may
confirm the current projection but cannot turn Download or unsupported content into Preview.
It never derives durable removal or retry permission from lifecycle; the server returns both
capabilities for the exact caller.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:frontend`, it may depend on the pure file model,
generated contracts, and generic frontend gateways. Feature and app packages depend on it, never
the reverse.

## See also

- [Conversation adapter](../adapter/README.md)
- [Conversation assets model](../../../../models/conversation-assets/main/README.md)
- [Frontend state index](../../README.md)
