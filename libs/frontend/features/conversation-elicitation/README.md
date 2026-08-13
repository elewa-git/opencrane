# Conversation elicitation feature

> [frontend](../../README.md) › [features](../README.md) › conversation elicitation

## What it owns

This package composes the four elicitation controls into one recoverable conversation card. It
keeps choosing and submitting visibly separate, shows the authoritative terminal outcome, and
offers verified sign-in recovery without losing the participant's draft.

```
 state projection + controlled draft
                 │
                 ▼
      elicitation card shell
       ├─ body control
       ├─ explicit Submit
       └─ sign-in recovery
                 │ intent only
                 ▼
        state/conversation/elicitation
```

In this flow: [`elements/elicitation`](../../elements/elicitation/README.md) renders draft controls;
the parent workspace integration in issue #351 will connect emitted intents to the state store.

## Public surface

- `ConversationElicitationCardComponent` renders one exact request, controlled draft, recovery
  action, and separate submit intent.

## Boundary

This is a presentational feature seam, not a route and not an API client. It never creates an
approval, advances a run, or assumes that a browser selection was accepted.

## Dependency direction

The card depends inward on the elicitation elements and shared contracts. The workspace may compose
it; this package imports no sibling feature, app, backend, or HTTP adapter.

## See also

- Parent index: [`libs/frontend/features`](../README.md)
- State owner: [`state/conversation/elicitation`](../../state/conversation/elicitation/README.md)
