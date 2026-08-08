# @opencrane/features/onboarding — governed persona onboarding

> [frontend](../../README.md) › [features](../README.md) › onboarding

## What it owns

This feature owns the signed-in person's routed persona survey, review, and one-time first-chat
screens. It is the visible part of a server-owned process: the persona authority supplies the
reviewed questions and immutable revision, then onboarding pins the matching reviewed bootstrap
source and validates the exact three-answer exchange before completion.

```
 signed-in owner
       │ durable persona snapshot
       ▼
 ┌────────────────────────────────┐
 │ features/onboarding  ◄── HERE  │  survey · review · approve · first chat
 └────────────────────────────────┘
       │ intent through state/onboarding
       ▼
 persona/adapter ................. generated owner-only API client
```

**In this flow:** [state/onboarding](../../state/onboarding/README.md) ·
[state/persona/adapter](../../state/persona/adapter/README.md)

The survey and first-chat composer hold only the unsaved input currently visible. Refreshing,
changing device, or retrying resumes the server-confirmed position. A failed first-chat answer keeps
the same text and idempotency key for retry, while the browser can neither select the next question
nor assert completion.

## Public surface

- `ONBOARDING_ROUTES` — lazy `/survey`, `/review`, and `/chat` route children mounted by `opencrane-ui`.
- The internal `PersonaFirstChatComponent` presentation boundary is covered in Storybook for the
  authoritative transcript, provenance, one controlled answer, and finite recovery states.

## Boundary

This package composes shared journey, progress, choice-card, and persona-summary elements. It does
not call HTTP, calculate persona scores, persist browser flags, select bootstrap content, run a
model, or mark onboarding complete; those remain behind the state-layer port and authenticated
server API. The first-chat screen is a deterministic onboarding exchange, not a general chat client.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:feature`. The
role constraint admits only shared elements and onboarding state; it cannot import the HTTP adapter,
another feature, an app, or backend source.

## See also

- Parent index: [features](../README.md)
- State orchestration: [onboarding](../../state/onboarding/README.md)
- Shared presentation: [elements/ui](../../elements/ui/README.md)
