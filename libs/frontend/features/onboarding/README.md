# @opencrane/features/onboarding — governed persona onboarding

> [frontend](../../README.md) › [features](../README.md) › onboarding

## What it owns

This feature owns the signed-in person's routed persona onboarding shell. One explicit lifecycle
switch selects an interview, resolution, review, or ready component from the authoritative server
projection. The persona authority supplies the reviewed questions, records each choice, computes any
tie, creates the immutable draft, and activates only the exact revision the person approves. After
approval, the first-chat screen renders the separately authoritative, reviewed three-answer
bootstrap exchange.

```
 signed-in owner
       │ durable persona snapshot
       ▼
 ┌────────────────────────────────┐
 │ features/onboarding  ◄── HERE  │  shell → interview · resolution · review · ready → first chat
 └────────────────────────────────┘
       │ intent through state/onboarding
       ▼
 persona/adapter ................. generated owner-only API client
```

**In this flow:** [state/onboarding](../../state/onboarding/README.md) ·
[state/persona/adapter](../../state/persona/adapter/README.md)

Each state component receives read-only evidence and emits typed intents. The component-scoped
`PersonaOnboardingStore` owns loading, single-flight command admission, errors, and adoption of the
returned projection. Refreshing, changing device, or retrying resumes the server-confirmed position;
a failed save never advances the screen. The first-chat composer holds only the unsaved input
currently visible and preserves the exact text and idempotency key across a failed answer request.

## Public surface

- `ONBOARDING_ROUTES` — lazy `/onboarding` shell and `/onboarding/chat` route mounted by
  `opencrane-ui`.
- The internal `PersonaFirstChatComponent` presentation boundary is covered in Storybook for the
  authoritative transcript, provenance, controlled answer, and finite recovery states.

## Boundary

This package composes shared journey, progress, choice-card, and persona-summary elements. State
components do not inject services, navigate between lifecycle screens, call HTTP, calculate persona
scores, persist browser flags, or activate a persona; those remain behind the shell, state-layer port,
and authenticated server API. The browser also cannot select bootstrap content, choose the next
question, run a model, or assert onboarding completion. The first-chat screen is a deterministic
onboarding exchange, not a general chat client.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:feature`. The
role constraint admits only shared elements and onboarding state; it cannot import the HTTP adapter,
another feature, an app, or backend source.

## See also

- Parent index: [features](../README.md)
- State orchestration: [onboarding](../../state/onboarding/README.md)
- Shared presentation: [elements/ui](../../elements/ui/README.md)
