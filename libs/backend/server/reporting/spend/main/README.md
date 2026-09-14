# @opencrane/backend/server/reporting/spend — recorded model usage and spend ceilings

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
 │  · recorded token usage  · global + per-account ceilings        │
 └───────────────────────────────────────────────────────────────┘
        │  persisted usage snapshots
        ▼
 OpenCrane product database
```

Invariant: authorization and each database query or budget write use the same Serializable Prisma
transaction. A denied budget mutation writes neither the setting nor decision evidence. Only a
P2034 rollback retries the complete operation, with fresh adapters and a three-attempt limit. A
token-usage row without a current read grant never reaches the response. The package does not
accept provider credentials or call a model provider directly.

## Public surface

- `tokenUsageRouter` — exposes per-account token usage at `/api/v1/token-usage`.
- `aiBudgetRouter` — exposes the global and per-account controls at `/api/v1/ai-budget`.
- `PrismaSpendUnitOfWork` — binds central authorization, budget
  persistence, and token-usage reads to one transaction.
- Spend authority, caller, budget, and token-usage types — the contracts used by routes and tests.

The public HTTP contract returns `{ currency, ceilingAmount }` for the global budget and
`{ userId, currency, ceilingAmount }` for each account budget. Budget write bodies may omit either
field: the existing handlers default the currency to `USD` and the ceiling to `0`. Budget updates
and account-budget removal return `204 No Content`. `GET /api/v1/token-usage` returns rows with
`userId`, input, output, and total token counts, `currency`, and `totalCost`; `budgetCeiling` is
omitted when no same-currency account or global ceiling applies. Missing Principals and denied
organization administration return `403`; malformed JSON returns `400` and unexpected route
failures use the server's standard `500` envelope.

## Boundary

Consumed by the OpenCrane HTTP bootstrap. It resolves the Principal from the authenticated
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
