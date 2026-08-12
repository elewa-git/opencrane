# @opencrane/features/conversation-assets — conversation file presentation

> [frontend](../../README.md) › [features](../README.md) › conversation assets

## What it owns

This feature package renders the accepted conversation-file language without owning a route. It
contains attachment chips and trays for the composer, transcript asset cards, and the grouped Files
panel. Every component receives a browser-safe presentation and emits typed intent; none calls the
server or predicts scan completion.

Participant uploads use a plain paper edge. Finalized assistant output uses the teal folded-corner
treatment and remains openable after the run or message ends. Scanning, ready, failed, inaccessible,
expired, removed, and unavailable states remain visibly distinct without revealing storage or scan
details.

## Public surface

- `ConversationAttachmentTrayComponent` and `ConversationAttachmentChipComponent`.
- `ConversationAssetCardComponent`.
- `ConversationFilesPanelComponent` and `ConversationFileRowComponent`.
- Pure presentation mappers and typed retry/remove/open/preview/download/focus intents.

The tray also presents empty-batch selection feedback and an indeterminate progressbar when the
browser transport cannot report a reliable upload percentage.

## Boundary

[#351](https://github.com/elewa-git/opencrane/issues/351) mounts these components in the workspace.
This package deliberately adds no temporary route and injects no gateway or store.

## Dependency direction

Tagged `scope:conversation-assets` and `layer:frontend`, it may compose the conversation-file state,
pure file policy, and generic frontend elements. It never imports a server implementation or app.

## See also

- [Conversation asset state](../../state/conversation/assets/README.md)
- [UI design target](../../../../docs/ui-design/README.md)
- [Frontend features index](../README.md)
