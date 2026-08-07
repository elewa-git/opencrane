# @opencrane/backend/server/iam/audit — the tamper-evident record of every access decision

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › audit

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers **who is making this request, and are they allowed to do this?** Audit owns the memory of
those answers: it records every authorisation decision the platform makes, and serves that history
back to operators through a read-only API.

It has two halves. The **write** half is a single helper the deciding packages call *inside their own
database transaction*, so the evidence of a decision is committed atomically with the decision
itself — a decision can never exist without its audit record, and vice versa. The **read** half is
the operator-facing API mounted at `/api/v1/audit`, which lists the trail for review.

```
 authorization / membership decide (allow or deny)
        │  __AppendAuditDecision — in the SAME transaction
        ▼
 ┌───────────────────────────────┐
 │   audit   ◄── HERE             │  store immutable decision evidence
 └───────────────────────────────┘
        │  GET /api/v1/audit
        ▼
  operator reviews the trail
```

**In this flow:** [authorization](../../authorization/main/README.md) · [membership](../../membership/main/README.md)

Invariant: a stored decision is immutable evidence — actor, silo, workload, and outcome, captured
exactly as decided. Because the write rides the caller's transaction, the trail cannot drift out of
sync with what actually happened: if the decision rolls back, so does its record.

## Public surface

- `__AppendAuditDecision` — append one immutable authorisation-decision record through the caller's
  active transaction (the write half used by the deciding domains).
- `__CreateStandaloneFirstUserAdmissionAuditAppender` — concrete transactional audit adapter the
  app composes into identity's one-time standalone-owner admission, without creating an IAM cycle.
- `auditRouter` and its route types — the read-only `/api/v1/audit` trail API.
- `_AuditOpenapiPaths` — the OpenAPI (REST API description) path fragment this domain contributes to the aggregated spec.
- `AuditDecisionRecord` and related contract types.

## Boundary

The write helper is consumed by [authorization](../../authorization/main/README.md) and
[membership](../../membership/main/README.md); the read API is consumed by operators via the SPA.
Audit only records and lists — it never makes an access decision itself.

## Dependency direction

Tagged `scope:audit`: it may depend only on `scope:audit` and `scope:shared` — the leanest tier, so
every other IAM domain can safely depend on it without creating a cycle.

## Data & persistence

Owns `AuditEntry` (the operator-facing trail) and `AuditDecision` (the immutable decision evidence)
in `apps/opencrane/prisma/schema/audit.prisma`.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [authorization](../../authorization/main/README.md) · [membership](../../membership/main/README.md) · [grants](../../grants/main/README.md)
