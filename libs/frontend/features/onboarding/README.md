# @opencrane/features/onboarding — governed persona onboarding

> [frontend](../../README.md) › [features](../README.md) › onboarding

## What it owns

This feature owns the signed-in person's routed persona survey and review screens. It is the visible
part of a server-owned process: the persona authority supplies the reviewed questions, records each
choice, computes any tie, creates the immutable draft, and activates only the exact revision the
person approves.

```
 signed-in owner
       │ durable persona snapshot
       ▼
 ┌────────────────────────────────┐
 │ features/onboarding  ◄── HERE  │  survey · tie choice · review · approve
 └────────────────────────────────┘
       │ intent through state/onboarding
       ▼
 persona/adapter ................. generated owner-only API client
```

**In this flow:** [state/onboarding](../../state/onboarding/README.md) ·
[state/persona/adapter](../../state/persona/adapter/README.md)

The survey holds only the unsaved choice currently visible on screen. Refreshing, changing device,
or retrying resumes the server-confirmed position; a failed save never advances the progress shown.

## Public surface

- `ONBOARDING_ROUTES` — lazy `/survey` and `/review` route children mounted by `opencrane-ui`.

## Boundary

This package composes shared journey, progress, choice-card, and persona-summary elements. It does
not call HTTP, calculate persona scores, persist browser flags, or activate a persona; those remain
behind the state-layer port and authenticated server API.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:feature`. The
role constraint admits only shared elements and onboarding state; it cannot import the HTTP adapter,
another feature, an app, or backend source.

## See also

- Parent index: [features](../README.md)
- State orchestration: [onboarding](../../state/onboarding/README.md)
- Shared presentation: [elements/ui](../../elements/ui/README.md)
