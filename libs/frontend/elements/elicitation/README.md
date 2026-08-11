# Elicitation elements

> [frontend](../../README.md) › [elements](../README.md) › elicitation

## What it owns

This package renders the four browser-safe question bodies: approval, single choice, multiple
choice, and free text. Each control emits only a typed draft; it cannot submit, approve, or advance
server state.

```
 server projection
       │
       ▼
 approval · single · multiple · text
       │ typed draft only
       ▼
 conversation-elicitation feature
```

In this flow: the feature owns submission, while the server remains the decision authority.

## Public surface

- `ElicitationApprovalComponent` discloses the exact action and emits approve or deny.
- `ElicitationSingleChoiceComponent` and `ElicitationMultipleChoiceComponent` emit bounded selections.
- `ElicitationFreeTextComponent` emits text within the server-owned browser limit.

## Boundary

The components depend only on Angular and local presentational types. They never import state, features, an
application, or a backend package. Prompts and disclosed consequences are rendered as text, never
as trusted markup.

## Dependency direction

Features may import this package; it depends only on Angular.

## Consumer

[`features/conversation-elicitation`](../../features/conversation-elicitation/README.md) composes
these controls inside the recoverable conversation card.

## See also

- Parent index: [`libs/frontend/elements`](../README.md)
- State owner: [`state/conversation/elicitation`](../../state/conversation/elicitation/README.md)
