# Conversation activity feature

> [frontend](../../README.md) › [features](../README.md) › conversation activity

## What it owns

This package renders the derived Activity index and emits canonical transcript deep links. Failed
tool attempts stay visible even while retrying; bounded technical fields are available only after
the participant opens the disclosure.

```
 canonical references + safe failure fields
                    │
                    ▼
               Activity list
        visible failure + retry state
        optional Technical details
                    │ deep-link intent
                    ▼
              workspace router (#351)
```

In this flow: [`state/conversation/elicitation`](../../state/conversation/elicitation/README.md)
derives the rows without copying conversation messages.

## Public surface

`ConversationActivityComponent` renders browser-safe rows and accepts one named header-action slot so
the owning workspace can supply a close control without moving panel visibility into this component.

- `ConversationActivityComponent` renders ordered safe rows and emits exact canonical coordinates.

## Boundary

The feature receives already-safe fields. It never renders provider bodies, credentials, request
headers, datasets, or secret material, and it owns no routing or API access.

## Dependency direction

The feature depends inward on the elicitation state row contract. The workspace may compose it;
this package imports no sibling feature, app, backend, or transport.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- Elicitation card: [`features/conversation-elicitation`](../conversation-elicitation/README.md)
