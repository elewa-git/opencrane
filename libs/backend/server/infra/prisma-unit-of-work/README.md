# @opencrane/backend/server/infra/prisma-unit-of-work — shared transaction envelope

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › prisma-unit-of-work

## What it owns

This package is the one envelope every declared Prisma unit of work runs inside: it opens the
transaction with an explicit isolation level, retries only failures Prisma proves were complete
rollbacks (P2002, P2034 by default), and rethrows the last conflict unchanged after the bounded
attempt budget. Around thirty adapters used to hand-roll this loop under eight different private
names, with drifting retryable-code sets, silently inherited isolation levels, and no way to set a
transaction timeout in one place.

```text
declared unit-of-work adapter (per domain)
        │ work callback + explicit policy
        ▼
┌──────────────────────────────────┐
│ prisma unit of work  ◄── HERE    │  open, isolate, retry proven rollbacks
└──────────────────────────────────┘
        │ one transaction client per attempt
        ▼
domain repositories bound to that attempt
```

**In this flow:** everything semantic stays with the calling adapter — outcome vocabularies,
post-exhaustion winner reads, and domain error translation are domain language, not plumbing.
The boundary checker (`npm run check:prisma-boundaries`) authorizes this package's runner as the
transaction owner and grants the work callback's parameter transaction-client authority at every
call site, exactly as it does for the central authorization transaction helper.

Invariant: a caller never places an effect that can survive database rollback inside `work`, and a
retry only ever repeats a complete idempotent operation whose previous attempt provably wrote
nothing.

## Public surface

- `___RunInPrismaUnitOfWork` runs one idempotent operation in a fresh transaction under an explicit policy.
- `___IsRolledBackConflict` tells a domain adapter whether a failure was a proven full rollback.
- `___ROLLED_BACK_CONFLICT_CODES` is the default proven-rollback code set (P2002, P2034).
- `PrismaUnitOfWorkPolicy`, `PrismaUnitOfWorkRunner`, and `PrismaUnitOfWorkWork` type the policy,
  the declared runner contract, and the work callback.

## See also

- Parent: [server infra](../README.md)
- Related: [Prisma ownership policy](../../../../../docs/agents/prisma.md) · [workflow contract](../workflows/contract/README.md)
