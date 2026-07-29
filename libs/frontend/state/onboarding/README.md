# @opencrane/state/onboarding — shared onboarding persistence

> [frontend](../../README.md) › [state](../README.md) › onboarding

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend). This
package owns the small pieces of *persisted* state the onboarding journeys need — the bits that must
survive a page reload or a redirect. It talks to the browser through the abstract `StorageGateway` from
[`utils/storage`](../utils/storage/README.md) rather than touching `localStorage` directly, so it
degrades gracefully where storage is unavailable.

It owns two independent concerns:

- **First-run flag** (`WelcomeOnboardingService`): a single persisted boolean recording whether the
  user has finished the operator app's welcome flow. It lives here, not in `features/welcome`, because
  both the welcome feature (which writes it) and the app's first-run route guard (which reads it) need
  it — and a route guard must not statically import a lazy-loaded feature.
- **Signup funnel cache** (`OnboardingCacheService`): saves the self-serve funnel's step + selections
  so progress survives the Zitadel OIDC sign-in redirect (OIDC is the login standard; the user leaves
  the app to authenticate and comes back). It also owns the funnel's step/state types.

Invariant: all persistence is **best-effort** — a missing or throwing store means onboarding is simply
treated as incomplete and writes silently no-op, never an error. The funnel cache is cleared once
signup completes.

## Public surface

- `WelcomeOnboardingService` — the first-run completed flag as a signal (`completed`, `markComplete`, `reset`).
- `OnboardingCacheService` — save/restore/clear the funnel step + selection across the OIDC redirect;
  restored browser data is rebuilt only after its step, plan, and account fields pass domain validation.
- `welcome-onboarding.util` — the pure completion-decision helper.
- `onboarding.types` — the funnel step, account, selection, and payment/provision state types.

## Boundary

Consumed by `features/welcome` and `apps/opencrane-ui` (the first-run guard). It persists small state
only; it makes no HTTP calls and defines no gateway port.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here `state/utils/storage`, `@opencrane/core`, and Angular — never on apps or server domains.

## See also

- Parent index: [state](../README.md)
- Siblings: [utils/storage](../utils/storage/README.md) · [core](../core/README.md)
