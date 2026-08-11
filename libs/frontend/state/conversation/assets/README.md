# @opencrane/state/conversation/assets — governed conversation file state

> [frontend](../../../README.md) › [state](../../README.md) › [conversation](../adapter/README.md) › assets

## What it owns

This package owns one mounted conversation's browser-safe file projection and exact upload intents.
It validates the complete ten-file, 200 MiB message selection before starting work, computes the
content digest locally, reuses the same idempotency key and bytes after a transport failure, and
adopts only the server's returned lifecycle.

The live gateway uses the generated Control Plane client. It never receives storage URLs, leases,
receipts, scanner evidence, or credentials.

## Public surface

- `ConversationAssetsStore` — component-scoped read resource, independent upload admission, retry,
  local pre-admission removal, and removal of exact reservations granted by server capability.
- `CONVERSATION_ASSETS_GATEWAY` and `ConversationAssetsGateway` — narrow transport port.
- `OpenCraneConversationAssetsGateway` — generated-client adapter.
- Browser-safe asset, pending-upload progress, typed selection-error, and server capability types.

## Boundary

The package prepares files and reflects durable server state; it does not attach an unchecked file
to a message. Message admission remains a server transaction and accepts only assets whose current
authoritative state is ready.
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
