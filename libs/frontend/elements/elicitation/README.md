# @opencrane/elements/elicitation — participant input controls

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

In this flow: the [conversation elicitation feature](../../features/conversation-elicitation/README.md)
owns submission, while the server remains the decision authority.

## Public surface

- `ElicitationApprovalComponent` discloses the exact action and display-safe proposed arguments. It
  emits an `ElicitationApprovalDraft`: the decision plus the scope (once, this session or every time)
  picked from the scopes the server offered. An explicitly hidden proposal disables every allow option
  while keeping denial available.
- `ElicitationExecutionConnectionPresentation` supplies the connection owner and credential-use
  text through `ElicitationApprovalPresentation.executionConnection`, separate from the human decision.
- `ElicitationSingleChoiceComponent` and `ElicitationMultipleChoiceComponent` emit bounded selections.
- `ElicitationFreeTextComponent` emits text within the server-owned browser limit.

## Boundary

The components depend only on Angular and local presentational types. They never import state, features, an
application, or a backend package. Prompts and disclosed consequences are rendered as text, never
as trusted markup. Tool proposal arguments render as escaped, bounded JSON and never as editable
fields or provider-specific change summaries.

Connection ownership and credential-use text come from the feature's reviewed server projection;
the element never guesses them from the current participant. Both rows render together when supplied
and remain visible while arguments are hidden or controls are disabled. Omission adds no placeholder
or ownership claim. These labels do not change approval availability or make credentials editable.

## Dependency direction

Features may import this package; it depends only on Angular.

## Consumer

[`features/conversation-elicitation`](../../features/conversation-elicitation/README.md) composes
these controls inside the recoverable conversation card.

The element specs cover supplied, omitted, escaped and long connection labels, controlled selection,
hidden-argument denial and disabled controls. Personal/company, narrow and sign-in-recovery
compositions belong in the feature's existing Storybook card catalogue; these element specs do not
provide visual acceptance.

## See also

- Parent index: [`libs/frontend/elements`](../README.md)
- State owner: [`state/conversation/elicitation`](../../state/conversation/elicitation/README.md)
