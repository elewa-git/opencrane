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

### Generated files

MCP completion uses `_CreateConversationGeneratedFileResultParticipant` to validate the admitted
`opencrane_files_create_csv` tool and its returned bytes. For a personal run, it rechecks the current requester and execution,
then saves encrypted file content, stable asset coordinates and an Absurd task in the same
transaction as the tool's metadata result. Failed capture cannot fall back to storing file text in
the invocation. Other embedded resources are rejected; ordinary text results keep their existing path.

The internal `agent-output/custody` codec splits one non-empty generated file of at most one MiB
into chunks that fit the existing encrypted conversation-payload limit. It base64-encodes each
chunk, encrypts it with the conversation payload cipher, and returns a content-free manifest that
binds the complete digest and length to every ordered ciphertext row.

The payload references authenticate the silo, conversation, authoring agent identity, requester
Principal and participant subject, source operation, chunk position and count, and full content
digest. Each encrypted row records the agent identity as its author; requester coordinates remain
separate ownership evidence. The first capture uses fresh encryption nonces. A retry must reuse its
saved manifest and ciphertext rows, then validate canonical base64, exact ordering, every digest and
the complete reconstructed bytes before release.

The internal `agent-output/promotion` adapter accepts only those reconstructed bytes. Immediately
before transfer it asks the transaction-owned generated-file authority for the original upload
lease and checks the operation, silo, Artifact, reserved revision, digest, length, media type and
unchanged deadline. It signs that saved lease through the existing Artifact crypto port, streams
the bytes through the existing private Artifact service transport, and returns only a verified
content-free receipt to the workflow checkpoint. It cannot reserve, replace or extend a lease.

An authority-ended answer is terminal only after the transaction owner has marked the generated
asset Failed and emitted the operation-scoped wake to both the generated-file task and its waiting
conversation turn. This keeps an expired or revoked execution from leaving an Uploading asset with
no owner.

The server registers `_RegisterConversationGeneratedFileWorkflow` to recover promotion and wait for
scanning. Each database step reuses current conversation and tool authorization through IAM's
server system actor. It never borrows the MCP Pod's identity after that Pod exits. The scanner uses
the same transaction-bound owner before publication and saves terminal task wakes after the asset,
revision and scan outcome agree. A clean scan cannot publish a file whose authority already ended.

Attaching the Ready revision to an assistant answer and proving the assembled download-after-restart
journey remain unfinished.

## Public surface

- `_CreateConversationGeneratedFileResultParticipant` captures permitted CSV output during MCP completion.
- `PrismaConversationGeneratedFileWorkflowUnitOfWork` and `GeneratedFileArtifactPromotionPort`
  advance the saved file through the original upload lease and verified promotion receipt.
- `_RegisterConversationGeneratedFileWorkflow` registers that progression with the existing engine.
- `PrismaConversationGeneratedFileWorkflowRepository` binds current authority and terminal events
  to the scanner transaction.
- `PrismaConversationAssetUnitOfWork` owns upload, list, read and removal transactions.
- `_CreateConversationAssetAuthority` composes uploads with scanner availability and private storage.
- `_CreateConversationAssetContentBroker` opens exact published bytes for an authorized file read.
- `PrismaConversationMessageAttachmentRepository` implements the conversation-owned attachment port
  after that transaction has admitted Conversation Use; it checks each source Artifact before binding.
- `PrismaConversationPromptDocumentRepository` resolves message-bound Ready PDFs through the current
  participant, source Artifact and converted-text lineage checks used by prompt compilation.
- `PrismaConversationAssetScanRepository` and `PrismaConversationAssetPreprocessRepository` apply file
  lifecycle changes through the scanner or converter's existing transaction.
- `__CreateConversationAssetRouter`, `_ResolveConversationAssetCaller` and
  `_ConversationAssetsOpenapiPaths` expose the authenticated participant API.

`src/service/` owns private byte brokers. `src/pdf-input/` owns the conversation checks around
converted text; it delegates revision lineage to the artifact package.
`src/agent-output/` groups resource validation, encrypted custody, capture persistence, promotion
and workflow progression. Low-level codecs remain private to that owner.

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

Generated files enter through the existing MCP completion boundary. Their Pods cannot schedule
server work. Artifact publication remains in the artifact package; task wakes contain operation
identifiers and outcomes, never file content or read credentials. The UI refreshes the authorized
file list while selected PDFs are Processing.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:backend`, it may depend on conversations, artifacts,
execution-run references, verified workload identity, shared contracts and pure conversation-file policy. Apps compose it;
frontend code consumes API contracts, not these persistence adapters.

## Data & persistence

Owns `ConversationAsset`, `ConversationGeneratedFile` and its ordered encrypted chunk references in `apps/opencrane/prisma/schema/conversation-assets.prisma`. Artifact,
revision, lease, scan and conversion records keep their artifact-domain ownership. The application
uses the reviewed fresh-install baseline; this package provides no database upgrade path.

## See also

- [Server](../../README.md)
- [Conversation authority](../../conversations/main/README.md)
- [Artifact authority](../../agents/artifacts/main/README.md)
- [Shared file policy](../../../../models/conversation-assets/main/README.md)

`PrismaConversationGeneratedFileResultRepository` projects a file outcome for the conversation
result reader in the same transaction. It selects the operation through the actual invocation row,
compares the complete captured metadata and returns Pending, Ready, Failed or Unavailable. Ready
requires a clean published revision and the original requester's current Artifact read permission.

`PrismaConversationGeneratedFileOutputLinkUnitOfWork` reloads the real turn receipt and binds the generated
asset to its exact message. A new link rechecks the current invocation and file read authority in
one transaction. An exact existing link is recovery evidence and does not require new execution
authority. Different output coordinates or a different existing message fail closed.
