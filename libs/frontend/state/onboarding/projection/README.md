# @opencrane/state/onboarding/projection — frontend first-chat vocabulary

> [frontend](../../../README.md) › [state](../../README.md) › [onboarding](../README.md) › projection

## What it owns

This package is the frontend-facing boundary for the pure first-chat projection vocabulary. It lets
the onboarding feature present validated route, persona, transcript, and completion values without
depending on the command-owning onboarding state package's internal source or widening every
frontend feature to every model package.

Used by: [`features/onboarding`](../../../features/onboarding/README.md).

## Public surface

- First-chat projection enums and TypeScript value types re-exported from
  [`models/user-onboarding`](../../../../models/user-onboarding/main/README.md).

## Boundary

This package contains no parser, store, command, gateway, HTTP adapter, persistence, or workflow
authority. Runtime data is validated by the model owner before onboarding state exposes it.

## Dependency direction

Tagged `scope:persona-onboarding` and `frontend-role:state`: it depends only on the
`scope:user-onboarding` pure model. Features may consume this surface, but the conversation
workspace imports the model directly and cannot reach onboarding stores or commands through it.

## See also

- Parent package: [onboarding state](../README.md)
- Model owner: [user-onboarding](../../../../models/user-onboarding/main/README.md)
- Feature consumer: [onboarding](../../../features/onboarding/README.md)
