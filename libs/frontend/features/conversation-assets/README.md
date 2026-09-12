# @opencrane/features/conversation-assets — conversation file presentation

> [frontend](../../README.md) › [features](../README.md) › conversation assets

## What it owns

This feature package renders the accepted conversation-file language without owning a route. It
contains a PDF picker, attachment chips and trays for the composer, transcript asset cards, and the grouped Files
panel. Every component receives a browser-safe presentation and emits typed intent; none calls the
server or predicts scan completion.

Ready cards and file rows also render the component-scoped content command separately from the
durable file state. One file can show an opening indicator or safe retry feedback without blocking
independent files or exposing a transport error.

Participant uploads use a plain paper edge. Finalized assistant output uses the teal folded-corner
treatment and remains openable after the run or message ends. Scanning, ready, failed, inaccessible,
expired, removed, and unavailable states remain visibly distinct without revealing storage or scan
details.

## Public surface

- `ConversationAttachmentTrayComponent` and `ConversationAttachmentChipComponent`.
- `ConversationPdfPickerComponent` — a narrow PDF-only chooser that emits browser files without reading them.
- `ConversationAssetCardComponent`.
- `ConversationFilesPanelComponent` and `ConversationFileRowComponent`.
- Pure presentation mappers and typed retry/remove/open/preview/download/focus intents.
- A distinct typed deselection intent for composer trays; durable removal remains a server capability.
- Required per-asset content-command presentation for idle, loading, and failed reads.

The tray also presents empty-batch selection feedback and an indeterminate progressbar when the
browser transport cannot report a reliable upload percentage.

## Boundary

[#351](https://github.com/elewa-git/opencrane/issues/351) mounts these components in the workspace.
This package deliberately adds no temporary route and injects no gateway or store.
The composer context may expose Deselect for any selected row, including a failed upload, without
turning that action into a request to delete the file from the conversation.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:frontend`, it may compose the conversation-file state,
pure file policy, and generic frontend elements. It never imports a server implementation or app.

## See also

- [Conversation asset state](../../state/conversation/assets/README.md)
- [UI design target](../../../../docs/ui-design/README.md)
- [Frontend features index](../README.md)
