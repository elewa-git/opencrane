# @opencrane/state/governance — protected reporting read contracts

> [frontend](../../README.md) › [state](../README.md) › governance

## What it owns

This package defines the browser read port for audit entries, recorded model usage and configured
spend ceilings. Its data types alias the generated application programming interface (API), while
nearby validators reject unexpected response fields and incomplete pagination before screens use them.

```
 governance screens ──reads──► governance port ◄── HERE
                                    ▲
                             signed-in adapter
```

**In this flow:** [governance screens](../../features/governance/README.md) own display and read state;
the [adapter](./adapter/README.md) owns HTTP transport.

An empty audit page can still have another page because permissions filter the candidate rows.
Missing usage ceilings remain absent; zero is not treated as missing. Snapshots supply no time
interval or freshness evidence, and configured ceilings do not prove runtime enforcement.

## Public surface

- `GOVERNANCE_READ_GATEWAY` and `GovernanceReadGateway` — four read operations, with optional abort signals.
- `GOVERNANCE_READER_IDENTITY` — app-bound signal identifying the authenticated reader; null closes reads.
- `GovernanceReadError` and `GovernanceReadErrorKinds` — fixed, safe error categories and messages.
- `GovernanceAuditQuery`, `GovernanceAuditPage`, `GovernanceAuditEntry`, `GovernanceTokenUsageRows`,
  `GovernanceTokenUsage`, `GovernanceBudget`, `GovernanceAccountBudgets`, `GovernanceAccountBudget` — generated API aliases.
- `___GovernanceAuditPageSchema`, `___GovernanceTokenUsageRowsSchema`, `___GovernanceBudgetSchema`,
  `___GovernanceAccountBudgetsSchema` — validators paired with those aliases.

## Boundary

The port offers no writes and decides no permissions. Screens must purge retained records and
invalidate pending reads when their authenticated reader changes or the server denies access.
Abort signals prevent late adapter results; screen stores also fence their own read generations.
The reader signal carries identity, never an inferred role or permission.

## Dependency direction

Tagged `scope:governance`, `frontend-role:state`, `layer:frontend` and `type:lib`. It may consume
shared contracts and frontend core primitives, never adapters, features, apps or backend code.

## See also

- Parent index: [state](../README.md)
- Live adapter: [governance adapter](./adapter/README.md)
- Consumer: [governance screens](../../features/governance/README.md)
