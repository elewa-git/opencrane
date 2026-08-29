# @opencrane/backend/server/iam/audit — authorised access to the audit trail

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › audit

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers **who is making this request, and are they allowed to do this?** This package owns the
operator-facing, read-only view of the resulting audit trail. The write-only sibling
[audit writer](../../audit-writer/main/README.md) appends decision evidence inside each deciding
domain's database transaction.

The API mounted at `/api/v1/audit` loads one candidate page, filters every row through the central
`AuthorizationAuthority`, and returns only the exact audit-log resources the current Principal may
read.

```
 audit writer ──► immutable decision rows
                         │
                         ▼
 ┌───────────────────────────────┐
 │   audit reader ◄── HERE      │  authorize and page exact resources
 └───────────────────────────────┘
        │  GET /api/v1/audit
        ▼
 operator reviews the permitted trail
```

**In this flow:** [authorization](../../authorization/main/README.md) · [membership](../../membership/main/README.md)

Invariant: a catalogue page and its authorization decisions share one short transaction, so a
revoked grant cannot race a separate audit query. This package never appends or changes evidence.

## Public surface

- `PrismaAuditCatalogueUnitOfWork` and `PrismaAuditCatalogueRepository` — item-filtered audit reads
  bound to the central authority and the same Prisma transaction.
- `auditRouter` and its route types — the read-only `/api/v1/audit` trail API, including the trusted
  caller and injected authority-factory contracts.
- `_AuditOpenapiPaths` — the OpenAPI (REST API description) path fragment this domain contributes to the aggregated spec.
- `AuditDecisionRecord` and related contract types.

## Boundary

The read API is consumed by operators via the SPA. Audit owns query and paging rules but delegates
every allow-or-deny decision to the central authority injected by the app. Product domains append
evidence through the separate audit-writer package.

## Dependency direction

Tagged `scope:audit`: it may depend on authentication, authorization, audit, and shared contracts.
Authorization depends only on the lower audit-writer leaf, so this reader may use authorization
without forming a package cycle.

## Data & persistence

Reads `AuditEntry` (the operator-facing trail) and `AuditDecision` (immutable decision evidence) in
`apps/opencrane/prisma/schema/audit.prisma`. Both row types store the owning `siloId`, and the
operator-facing index begins with that silo so candidate reads cannot cross organization storage.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [audit writer](../../audit-writer/main/README.md) · [authorization](../../authorization/main/README.md) · [membership](../../membership/main/README.md) · [grants](../../grants/main/README.md)
