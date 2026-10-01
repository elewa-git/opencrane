# @opencrane/features/governance — read-only audit and usage screens

> [frontend](../../README.md) › [features](../README.md) › governance

## What it owns

This feature presents audit entries, recorded token usage and returned budgets inside Settings.
Routed coordinators consume the governance state port; presentational components receive mapped
values and emit read intents. Global budgets and account overrides retain independent read states.

```
 protected API → governance state → route and mapper → reporting components ◄── HERE
                                          ▲                     │
                                          └──── read intents ───┘
```

**In this flow:** [governance state](../../state/governance/README.md) owns the browser read port;
[the application](../../../../apps/opencrane-ui/README.md) composes routes and concrete adapters.

Empty audit and usage lists can reflect permission filtering, not an absence of records. Recorded
usage is not presented as live or complete spending. Unknown values remain unknown and currencies
are not combined. A returned global USD zero can be the API default rather than configured policy;
this screen makes no claim about runtime enforcement.

## Public surface

`GOVERNANCE_ROUTES` exposes the audit and usage child routes for app-owned Settings composition.
Feature-local `AuditResultsComponent`, `TokenUsageSummaryComponent` and `BudgetSummaryComponent`
own their tables, read feedback, view types, stories and component tests. They do not fetch data.

## Boundary

The API remains the permission authority. Denied reads hide even accidentally supplied stale data;
refresh failures may retain data only with visible stale copy. Audit continuation remains available
when an empty filtered page has another cursor. Components never invent cursor values or issue
budget, permission or audit mutations.

## Dependency direction

Tagged `scope:governance`, `frontend-role:feature`, `layer:frontend` and `type:lib`. It consumes the
governance state port and shared elements, not concrete adapters, backend packages or other features.
The app composes this feature with the existing Settings frame.

## Component states and checks

Stories cover loading, ready, filtered-empty, refreshing, unavailable, retained-error, denied and unauthenticated
reads, plus audit continuation and independent budget failures. Long content is represented at the
supported 390-pixel width. Focused tests verify read intents, text escaping, unknown values, and
suppression of stale data. Storybook uses the application's fonts, tokens and providers.

New screenshots are review candidates until human approval; their generation does not establish an
accepted visual baseline or prove live account access, audit capture or usage sampling.

## See also

- Parent index: [features](../README.md)
- State port: [governance](../../state/governance/README.md)
- Shared controls: [UI elements](../../elements/ui/README.md)
- Settings frame: [settings](../settings/README.md)
