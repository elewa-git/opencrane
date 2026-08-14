# @opencrane/elements/conversation — reusable conversation presentation

> [frontend](../../README.md) › [elements](../README.md) › conversation

## What it owns

This package owns the small presentation pieces shared by direct chats, group chats, and Agent
threads. A feature supplies display-safe message and status models plus a controlled composer draft;
these elements render them and return typed user intents.

```
 state/store ── view models + controlled draft ──► feature
                                                    │
                                                    ▼
                                      conversation elements  ◄── HERE
                                                    │ draft/send intents
                                                    ▼
                                              feature/store
```

**In this flow:** [`state`](../../state/README.md) · [`features`](../../features/README.md)

The package never loads a conversation, starts a run, keeps a draft, or decides whether an action is
allowed. Rich cards use a named slot so governed asset, elicitation, and A2UI renderers keep their own
contracts.

## Public surface

- `ConversationMessageComponent` renders one message and a named rich-card slot.
- `ConversationComposerComponent` displays a host-owned draft and emits edit or submit intents.
- `ConversationStatusLineComponent` announces one display-safe status.
- `ConversationRichTextComponent` displays HTML already sanitized by the shared conversation renderer.
- `ConversationRunActionsComponent` displays run status and emits controlled steer, cancel, and retry intents.
- The exported enums and presentation types keep those components finite and testable.

## Boundary

These are presentation-only components. They accept no credentials, transport objects, raw tool
payloads, or command authority.

## Dependency direction

The package carries `layer:frontend` and `frontend-role:elements-composite`. It may compose the
shared UI element package, but it must not import state, a feature, a backend package, or an app.

## See also

- Parent index: [`libs/frontend/elements`](../README.md)
- Siblings: [`ui`](../ui/README.md) · [`a2ui`](../a2ui/README.md) · [`elicitation`](../elicitation/README.md)
