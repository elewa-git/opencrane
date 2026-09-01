# @opencrane/backend/server/iam/audit-writer — transaction-scoped decision evidence

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › audit writer

## What it owns

This package is the write-only half of OpenCrane's identity and access management audit trail. A
product domain calls it inside the database transaction that makes an authorization decision or
protected change. The row therefore commits or rolls back with the action it explains.

The split keeps central authorization below the operator-facing audit reader. Authorization can
append evidence without depending on the audit API, while the audit API can use central
authorization to filter what an operator may read without creating a package cycle.

```text
 product transaction
        │ decision and protected write
        ▼
 ┌──────────────────────────────┐
 │ audit writer  ◄── HERE       │ append immutable evidence
 └──────────────────────────────┘
        │ committed row
        ▼
 audit reader ──► authorised operator
```

**In this flow:** [authorization](../../authorization/main/README.md) ·
[audit reader](../../audit/main/README.md)

The invariant is atomic evidence: a caller cannot commit the product change without its audit row,
and a rolled-back change leaves no misleading row behind. The package never opens a transaction
and never decides whether an action is allowed.

## Public surface

- `PrismaAuditDecisionWriterRepository` writes one immutable decision through a transaction the caller owns.
- `AuditDecisionRecord` carries the actor, resource, action, policy and outcome evidence.
- `AuditDecisionAppendReceipt` returns the identifier of the `AuditDecision` row inserted by the
  caller's transaction, so a protected domain can retain a precise reference if that transaction commits.
- `__CreateStandaloneFirstUserAdmissionAuditAppender` adapts the first-owner admission port to the
  same append-only row.

## Boundary

Authorization, membership and first-owner admission consume this package. Agent publication now
records its protected effects through the central authority, which reaches this writer through its
transaction-bound recorder. The operator-facing audit route belongs to the sibling audit reader
package. This writer owns no HTTP route, grant evaluation, catalogue filtering or product
lifecycle rule.

## Dependency direction

Tagged `scope:audit-writer`: it may depend only on its own leaf scope and shared contracts. The
separate tag makes the cycle-breaking boundary executable: packages that decide may depend on this
writer, while this writer cannot import authorization or the audit reader back.

## Data & persistence

Writes `AuditDecision` rows from `apps/opencrane/prisma/schema/audit.prisma`. Every write uses a
`Prisma.TransactionClient` supplied by the deciding domain, so there is no independent commit path.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [audit reader](../../audit/main/README.md) · [authorization](../../authorization/main/README.md) · [membership](../../membership/main/README.md)
