# @opencrane/backend/server/reporting/spend — LLM spend, budgets & virtual keys

> [backend](../../../../README.md) › [server](../../../README.md) › [reporting](../../README.md) › spend

## What it owns

This package is part of **Reporting** — the economics side of OpenCrane. It owns token-usage views
and each organization's global and per-account budget ceilings that cap model use.

It reads the canonical usage snapshots and exposes the operator's token-usage and budget controls.
Budget reads and writes require the exact organisation `administer` grant. Token-usage rows are a
catalogue: one batch decision returns only the exact rows the current Principal may read.

```
 authenticated Principal
        │  exact token-usage reads · organisation budget administration
        ▼
 ┌───────────────────────────────────────────────────────────────┐
 │  spend   ◄── HERE                                               │
 │  · aggregate token usage  · global + per-account ceilings       │
 └───────────────────────────────────────────────────────────────┘
        │  persisted usage snapshots
        ▼
 OpenCrane product database
```

Invariant: authorization and each database query or budget write use the same Prisma transaction.
A denied budget mutation writes neither the setting nor decision evidence, and a token-usage row
without a current read grant never reaches the response. The package does not accept provider
credentials or call a model provider directly.

## Public surface

- `tokenUsageRouter` — exposes per-account token usage at `/api/v1/token-usage`.
- `aiBudgetRouter` — exposes the global and per-account controls at `/api/v1/ai-budget`.
- `PrismaSpendUnitOfWork` and `PrismaSpendRepository` — bind central authorization, budget
  persistence, and token-usage reads to one transaction.
- Spend authority, caller, budget, and token-usage types — the contracts used by routes and tests.

## Boundary

Consumed by the opencrane-server HTTP layer. It resolves the Principal from the authenticated
request and delegates permission decisions to `AuthorizationAuthority`; it does not route model
calls itself — that is LiteLLM's job.

## Dependency direction

Tagged `scope:spend`: it may depend on authentication, authorization, spend, and shared contracts,
never on apps or sibling product domains.

## Data & persistence

Owns `TokenUsageSnapshot`, `GlobalBudgetSetting`, and `AccountBudgetSetting` in
`apps/opencrane/prisma/schema/spend.prisma`. Every row carries `siloId`; budget primary keys and
token-usage uniqueness include that silo, so two organizations may use the same account and
currency coordinates without sharing data.

## See also

- Parent index: [reporting](../../README.md)
- Related API: [OpenAPI overview](../../../../../../website/reference/api-overview.md)
