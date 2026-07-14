# OpenCrane UI handoff — migration inventory

## Migration rule

Reuse keeps behavior and package ownership; migrate moves route/view ownership while retaining
behavior; restyle changes presentation only; replace supersedes an implementation after parity;
remove occurs only in coordinator-owned cleanup after consumer search, replacement tests, combined
live acceptance, and independent review.

## Existing implementation disposition

| Current area | Disposition | Target / constraint |
|---|---|---|
| Root app routes, guards, login, no-tenant, welcome, customer-admin, `/admin` | Reuse; migrate only the root workspace mount | Preserve all existing guards and out-of-scope routes. |
| `features/workspace` routes, shell, sidebar, session page | Migrate/restyle | App-local Workspace/Session routes and facade; preserve persistent outlet, notification behavior, tenant switching, and first-message relay. `/tools` remains routed. |
| `features/conversation` | Migrate/restyle presentation | Preserve live gateway, history, reconnect, abort, retry, picker, safe scroll, Markdown, tools, files, share gating, and error states. |
| `features/context` | Reuse or deliberately migrate | The new picture omits this existing capability; deletion requires a product decision and parity evidence. |
| `elements/a2ui` | Reuse | It consumes conversation render and remains workspace-route-scoped. |
| `features/settings` | Replace local section switching with routed shell; migrate/restyle supported sections | Preserve resource/error behavior. Unsupported local/fixture controls remain disabled or leave scope. |
| `features/tools` | Reuse; selectively compose supported behavior | It still owns `/tools` and `/admin`. MCP catalogue is not automatically the Skills marketplace or Channels. |
| `elements/ui` | Migrate/restyle behind compatibility exports | Avatar, row, heading, save, scope, collapsible, and ledger components have consumers across both lanes and Tools/Context; do not delete during a lane. |
| Global styles, fonts, PrimeNG preset | Replace/restyle under coordinator ownership | Preserve existing consumers until both lanes migrate; remove old assets only after repository-wide reference search. |
| `state/core`, `state/gateways`, platform, storage | Reuse | Shared identity, capability, provider registration, and cache infrastructure; never duplicate app-locally. |
| conversation adapter/cache/render | Reuse behind Session facade | Mandatory regression seams; render is also consumed by A2UI. |
| settings adapter | Reuse/migrate behind Settings facade | Existing live owner for tenant profile projection, spend, contract, datasets, Skills, and policy reads. |
| provider-key adapter | Reuse | Write-only credential semantics; public changes require coordinator review because `/admin` consumes it. |
| MCP and tenant adapters | Reuse | Shared by Tools/customer-admin and gateway registration outside the handoff. |
| demo/static data | Replace as production source | Retain only explicit test fixtures. Demo departments, sessions, budget breakdowns, channels, and external avatar URLs never become production state. |

## Shared component disposition

| Existing / required element | Decision |
|---|---|
| Avatar, settings row, section heading, save action, scope chip, toggle, sidebar | Migrate/restyle with compatibility until all verified consumers move. |
| Collapsible section and ledger card | Reuse/restyle; Context and Conversation both consume them. |
| Progress meter, citation strip, settings sub-page header | New presentational components with frozen signal inputs/outputs and no business logic. |

## Test ownership and parity

- Migrate workspace relay, session-ID, tenant-switcher, routed Settings, resource, form, and shared
  component tests with their new owners; retain legacy suites until replacement parity passes.
- Keep all conversation protocol/history/reconnect/media, render, IndexedDB, session-store, gateway,
  tenant, MCP, provider-key, and A2UI suites as regression gates.
- G1 adds app-local lint/test targets plus Playwright `e2e`, `visual`, and `live` targets. Visual
  baselines use a zero-unexplained-diff policy; live runs cannot fall back to fixtures.

## Coordinator deletion list for G4

The following are candidates, not pre-approved deletions: superseded workspace routes/components,
superseded conversation view components, superseded Settings page/sections, migrated UI compatibility
exports, demo production data, legacy theme/font assets, and obsolete route/barrel shims.

Do not delete `elements/ui`, `state/core`, `state/gateways`, conversation render/cache, A2UI, tenant or
MCP adapters, Context, or Tools as a blanket operation. Each candidate requires an approved inventory
entry, consumer search, replacement tests, G3 live pass, separate revertible commit, full gate rerun,
and independent review.

## Highest-risk edges

1. Workspace route deletion can break `/`, Session, Settings, and `/tools` together.
2. `elements/ui` has consumers across five feature areas.
3. conversation render is shared by the adapter, old view, and A2UI.
4. `state/core` and `state/gateways` are app-wide infrastructure, not legacy Session UI.
5. tenant and provider-key adapters have customer-admin or `/admin` consumers outside Workflow B.
6. Context is real existing functionality absent from the handoff image.
