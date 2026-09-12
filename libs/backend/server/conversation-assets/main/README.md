# @opencrane/backend/server/conversation-assets — conversation file authority

> [backend](../../../README.md) › [server](../../README.md) › conversation assets

## What it owns

This package lets a participant upload a file, follow its processing, attach a checked PDF to a
message, and reopen an authorized file later. It owns conversation-file reservations and metadata;
the artifact package owns stored revisions, scanning and PDF conversion.

```text
participant file -> reservation -> quarantine -> clean scan -> PDF conversion
                                                                |
                                                                v
                       message attachment <- Ready file -> preview/download
```

A PDF stays Processing after its clean scan. Only a completed conversion with the exact source and
text revisions makes it Ready. A terminal conversion failure makes it Failed in the same database
transaction. Other supported media become Ready after their clean scan.

Message attachment admission accepts at most ten participant-owned PDFs with a combined source
size of 200 MiB. It binds their ids to the message in the same transaction that saves its encrypted
payload. A retry must present the original set, including when that set was empty. A lost history
response keeps the bindings reserved for the same message key.

## Public surface

- `PrismaConversationAssetUnitOfWork` owns upload, list, read and removal transactions.
- `_CreateConversationAssetAuthority` composes uploads with scanner availability and private storage.
- `_CreateConversationAssetContentBroker` opens exact published bytes for an authorized file read.
- `PrismaConversationMessageAttachmentRepository` implements the conversation-owned attachment port
  over the message transaction.
- `PrismaConversationPromptDocumentRepository` resolves message-bound Ready PDFs through the current
  participant, source Artifact and converted-text lineage checks used by prompt compilation.
- `PrismaConversationAssetScanRepository` and `PrismaConversationAssetPreprocessRepository` apply file
  lifecycle changes through the scanner or converter's existing transaction.
- `__CreateConversationAssetRouter`, `_ResolveConversationAssetCaller` and
  `_ConversationAssetsOpenapiPaths` expose the authenticated participant API.

`src/service/` owns private byte brokers. `src/pdf-input/` owns the conversation checks around
converted text; it delegates revision lineage to the artifact package.

## Boundary

Every protected operation uses central product authorization. Conversation participation and active
organisation membership remain separate requirements. Source Artifact grants use the caller's
current Principal and inherited Group permissions; ownership never substitutes for a grant.

The conversation authority checks current message Use permission and owns the surrounding
Serializable transaction. Attachment admission checks each source's Read and Edit permission,
requester ownership, Ready state and completed conversion. A denial must roll back the whole message,
including encrypted payload and audit writes. This package never commits or unbinds independently.

Browser views contain safe metadata and a nullable pair of artifact/revision ids so a file card can
join an exact immutable message block. Those ids grant no read authority. Storage addresses, signed
leases, scan evidence and converted text stay inside the server. Every preview or download checks
current participant and source Artifact access before opening its exact published revision.

Prompt compilation resolves an exact message block, participant-owned source revision and completed
conversion in a short transaction. It loads the converted bytes after that transaction ends, then
repeats every coordinate and current-authority check inside the compiler transaction. The converted
text remains an internal input and never becomes part of the browser asset projection.

Removal is limited to the creating participant's unlinked Uploading reservation with no revision.
It revokes the write lease and queues the artifact for deletion. Bound files and uploaded content
cannot be removed through that command. If the scanner is unavailable, new upload admission fails
before promotion. Existing Ready-file reads remain available under current permissions.

The package has no generated-output ticket, Pod output route or durable asset-change publisher.
The UI refreshes the authorized file list while selected PDFs are Processing. Generated file
production remains a separate capability.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:backend`, it may depend on conversations, artifacts,
execution-run references, shared contracts and pure conversation-file policy. Apps compose it;
frontend code consumes API contracts, not these persistence adapters.

## Data & persistence

Owns `ConversationAsset` in `apps/opencrane/prisma/schema/conversation-assets.prisma`. Artifact,
revision, lease, scan and conversion records keep their artifact-domain ownership. The application
uses the reviewed fresh-install baseline; this package provides no database upgrade path.

## See also

- [Server](../../README.md)
- [Conversation authority](../../conversations/main/README.md)
- [Artifact authority](../../agents/artifacts/main/README.md)
- [Shared file policy](../../../../models/conversation-assets/main/README.md)
