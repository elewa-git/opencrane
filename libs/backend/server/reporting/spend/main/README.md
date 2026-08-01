# @opencrane/backend/server/reporting/spend — LLM spend, budgets & virtual keys

> [backend](../../../../README.md) › [server](../../../README.md) › [reporting](../../README.md) › spend

## What it owns

This package is part of **Reporting** — the economics side of OpenCrane. It owns token-usage views
and the global and per-account budget ceilings that cap model use.

It reads the canonical usage snapshots and exposes the operator's token-usage and budget controls:

```
 dashboard / operator
        │  GET token usage · manage budgets
        ▼
 ┌───────────────────────────────────────────────────────────────┐
 │  spend   ◄── HERE                                               │
 │  · aggregate token usage  · global + per-account ceilings       │
 └───────────────────────────────────────────────────────────────┘
        │  persisted usage snapshots
        ▼
 OpenCrane product database
```

Invariant: budget and token-usage reads use the canonical product database. The package does not
accept raw provider credentials or call a model provider directly.

## Public surface

- `tokenUsageRouter` — exposes per-account token usage at `/api/v1/token-usage`.
- `_GetGlobalBudget` / `_PutGlobalBudget`, `_GetAccountBudgets` / `_PutAccountBudget` / `_DeleteAccountBudget` — the global and per-account monthly ceilings.
- `aiBudgetRouter` — exposes the global and per-account controls at `/api/v1/ai-budget`.

## Boundary

Consumed by the opencrane-server HTTP layer. It reports token usage and controls budgets; it does
not route model calls itself — that is LiteLLM's job.

## Dependency direction

Tagged `scope:spend`: it may depend only on `scope:spend` and `scope:shared` — never on apps or
sibling domains.

## Data & persistence

Owns `TokenUsageSnapshot`, `GlobalBudgetSetting`, and `AccountBudgetSetting` in
`apps/opencrane/prisma/schema/spend.prisma`.

## See also

- Parent index: [reporting](../../README.md)
- Related API: [OpenAPI overview](../../../../../../website/reference/api-overview.md)
