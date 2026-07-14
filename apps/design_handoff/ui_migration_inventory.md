# OpenCrane UI handoff — mock migration inventory

## Migration rule

Reuse stable presentation and routing behavior; migrate route/view ownership app-local; restyle to
the handoff; replace live data dependencies with the shared mock provider for this UI delivery; remove
superseded frontend paths only during coordinator cleanup after consumer search and replacement tests.

No backend adapter, generated contract, CLI command, OIDC flow, deployment, or live Gateway behavior
is changed by this track.

## Existing implementation disposition

| Current area | Decision | Mock UI target / constraint |
|---|---|---|
| Root app routes, guards, login, no-tenant, welcome, customer-admin, `/admin` | Preserve production behavior | An explicit mock build overrides access/first-run guard tokens and identity/tenant state; production guard implementations remain unchanged. |
| `features/workspace` shell/routes/sidebar | Migrate/restyle | App-local Workspace routes and `SessionFacade`; preserve persistent outlet and `/tools`. |
| `features/conversation` | Reuse presentation selectively | Reuse Markdown, message/tool/A2UI concepts and scrolling behavior; replace transport/history dependencies with `MockSessionService`. |
| `features/context` | Reuse presentation concepts | Map citations/scope/ledger visuals from typed mock data; do not delete the existing feature in a lane. |
| `elements/a2ui` and conversation render | Reuse where compatible | Feed deterministic mock render blocks; no Gateway dependency in handoff tests. |
| `features/settings` | Replace section switching; migrate/restyle | Nested Settings routes backed entirely by `SettingsFacade` and typed mock services. |
| `features/tools` | Preserve outside scope | Do not repurpose or delete `/tools` or `/admin`; recreate handoff Skills/Channels/provider states in the mock layer. |
| `elements/ui` | Migrate/restyle behind compatibility | Shared consumers remain until coordinator cleanup. |
| Global styles, fonts, PrimeNG preset | Replace/restyle | Coordinator-owned semantic theme and self-hosted fonts. |
| `state/core`, `state/gateways`, backend-facing adapters | Preserve outside scope | Do not edit or register them for this mock UI. App-local mock facades are explicitly handoff-only. |
| existing demo/static data | Normalize and replace | Move approved content into typed scenario fixtures with seeded IDs/time and deterministic reset. |

## Shared component disposition

| Existing / required element | Decision |
|---|---|
| Avatar, settings row, heading, save action, scope chip, toggle, sidebar | Migrate/restyle under coordinator ownership. |
| Collapsible section and ledger/card presentation | Reuse/restyle where they match the handoff. |
| Progress meter, citation strip, settings sub-page header | New presentational components with frozen signal APIs. |

## Test ownership

- Preserve useful legacy presentation tests until replacement UI tests pass.
- G1 adds app lint/unit targets and Playwright `e2e`/`visual` targets; there is no live target.
- Unit and E2E tests select `default`, `empty`, `loading`, `error`, `permission`, `limits`, `offline`,
  and `long-content` modes through the shared scenario service.
- Mock E2E uses deterministic identity/tenant/access/first-run providers; the production build proves
  those overrides are absent.
- Visual baselines use a zero-unexplained-diff policy and deterministic clock/ID/reset behavior.

## G4 deletion candidates

Candidates are superseded workspace/conversation/settings view components, migrated UI compatibility
exports, old demo data, legacy theme/font assets, and obsolete route/barrel shims. No lane deletes
shared state, gateway registration, backend-facing adapters, A2UI/render, Context, Tools, or root
auth routes. The coordinator requires consumer search, replacement tests, combined acceptance, a
separate revertible commit, full gate rerun, and independent review.
