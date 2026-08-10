# @opencrane/state/persona/adapter — typed personal-persona gateway

> [frontend](../../../README.md) › [state](../../README.md) › [persona](../README.md) › adapter

## What it owns

This package implements the browser transport for the signed-in owner's persona lifecycle. It
translates the generated control-plane client into the narrow `PersonaGateway` owned by
`state/onboarding`, including resumable status, survey answers, tie choices, draft creation, and
approval.

```
 state/onboarding
       │ PersonaGateway intent
       ▼
 ┌───────────────────────────────┐
 │ persona/adapter  ◄── HERE     │  typed generated client only
 └───────────────────────────────┘
       │ authenticated /api/v1/me/persona requests
       ▼
 server persona authority
```

**In this flow:** [state/onboarding](../../onboarding/README.md) · the server persona authority

The adapter delegates every response to the model-adjacent validator in `state/onboarding`. It never
reconstructs scores, accepts owner coordinates, or stores an onboarding result in the browser.

## Public surface

- `OpenCranePersonaGateway` — live adapter over `ControlPlaneApiService.client`.

## Boundary

Bound by `apps/opencrane-ui` to the port owned by `state/onboarding`. It owns transport adaptation
only; the server owns identity, domain validation, scoring, immutable evidence, drafts, and activation.

## Dependency direction

Tagged `scope:persona-onboarding`, `type:lib`, `layer:frontend`, and `frontend-role:adapter`. Its role
constraint permits only frontend core and the onboarding state port/model. It may not import shared
elements, features, apps, or backend source.

## See also

- Parent group: [persona](../README.md)
- State index: [state](../../README.md)
- Consumer: [onboarding](../../onboarding/README.md)
- Typed client: [frontend core](../../../core/README.md)
