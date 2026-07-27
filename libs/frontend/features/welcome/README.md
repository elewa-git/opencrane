# @opencrane/features/welcome — first-run onboarding

> [frontend](../../README.md) › [features](../README.md) › welcome

## What it owns

This is a frontend **feature** package (a lazy-loaded route plus its components — the browser only
downloads its code when the route is first opened). It owns first-run onboarding: the guided welcome
shown the first time an authenticated user or organisation admin lands in the workspace. This flow
writes nothing to the server.

It drives a short funnel, a PrimeNG Stepper stepped by a `WelcomeStep` enum:

```
 workspace entry, welcome not yet completed
        │  1. greet + show the user's resolved workspace
        ▼  2. capture light, local-only personalisation
 three-card tour
        ▼  3. Finish → markComplete() → navigate to "/"
 workspace
```

The completed flag is stored in the browser's `localStorage`, so the funnel does not reappear; it
degrades gracefully when storage is unavailable.

## Public surface

- `WELCOME_ROUTES` — the lazy route table (funnel mounted at `""`).
- `WelcomePageComponent` — the stepped page.
- `WelcomeOnboardingService` — the `localStorage`-backed gate exposing a `completed` signal and
  `markComplete()`.
- `welcome.util` — the pure step machine (`_NextStep`/`_PreviousStep`) and first-run flag helpers.

## Boundary

The host app mounts `WELCOME_ROUTES` (at `/welcome`) and redirects newcomers there while
`completed()` is `false`; the library does not self-mount. It must not import other feature
packages. Personalisation is local-only today — there is no preferences endpoint behind it yet.

## Dependency direction

Tagged `scope:web` (the frontend dependency tier): it may import only other `scope:web` packages
and `scope:shared` contracts. It depends on `@opencrane/state/core` for read-only `SessionStore`
signals (`displayName`, `currentTenant`) and on PrimeNG.

## See also

- Parent index: [features](../README.md)
- Session store: [state/core](../../state/core/README.md)
- Next screen: future workspace surface
