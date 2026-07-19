# @opencrane/state/onboarding — onboarding progress domain state

Owns the onboarding domain's shared persistence state. `WelcomeOnboardingService` holds the
first-run completed flag as a signal — written by the welcome feature, read by the operator
app's first-run route guard; it lives here because a route guard must not statically import a
lazy-loaded feature. `OnboardingCacheService` persists the self-serve funnel's step and
selection in session storage so progress survives the Zitadel OIDC redirect. Pure decision
logic (`_HasCompletedWelcome`) is exported separately for testing without DI.

Both services go through the abstract storage gateways from
`@opencrane/state/utils/storage`, so unavailable storage (SSR, private mode, desktop) degrades
to "onboarding incomplete" and silent no-op writes rather than errors.

Consumed by `apps/opencrane-ui` (first-run guard) and `features/welcome`. Tagged
`scope:web`/`type:state`: may depend only on `scope:web` and `scope:shared` libs — never on
backend packages or apps.
