# @opencrane/backend/server/iam/grants — explicit resource sharing

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › grants

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers **who is making this request, and are they allowed to do this?** Grants owns the resource-
sharing process that lets a user delegate direct read access to another local Principal.

A **share** pairs an explicit `ResourceShareRecipient` relation with one generic `AuthorizationGrant`:
"this Principal may read this exact resource at its owner's Personal boundary". The retained API lists
migrated shares and revokes recipients. Creation is absent until resource owners expose an authoritative
lifecycle boundary.

```
 user inspects or revokes a migrated share
        │  verified OIDC identity becomes one local Principal
        ▼
 ┌───────────────────────────────┐
 │   grants   ◄── HERE            │  lists relations and revokes relation + grant
 └───────────────────────────────┘
        │  one transaction commits both records or neither
        ▼
 authorization resolves future resource:read decisions
```

**In this flow:** [authorization](../../authorization/main/README.md) · [groups](../../groups/main/README.md)

Invariant: revocation updates the explicit recipient and its exact linked grant in one transaction.
The route receives a local Principal resolved from the verified OIDC issuer and
subject; it never queries Prisma or accepts caller identity from the request body. Revocation soft-
revokes the grant for audit and recovery while removing the live recipient relation.

Listing and revocation also pass through the central transaction-bound authority on the
`ResourceShare` coordinate. The owner receives exact Read and Revoke grants; each recipient has a
separately managed exact Read grant. A current direct or inherited Group Revoke grant may delegate
revocation without changing the stored owner. The owner relation remains only the integrity
coordinate for finding the manager-owned recipient grant; it is not a second authorization rule.
Revoking one recipient removes the relation, soft-revokes the linked underlying-resource grant, and
soft-revokes that recipient's ResourceShare projection in the same transaction, without affecting
other recipients.

## Public surface

- `ResourceShareService` — the atomic list and revoke authority.
- `ResourceShareUnitOfWork` and `ResourceShareRepository` — the transaction and persistence ports.
- `PrismaResourceShareUnitOfWork` — the application-composed PostgreSQL transaction adapter.
- `resourceSharesRouter` and its transport types — the `/api/v1/resource-shares` HTTP adapter.
- `_GrantsOpenapiPaths` — the OpenAPI (REST API description) path fragment this domain contributes to the aggregated spec.

## Boundary

Consumed by the server's HTTP composition root and by [api-spec](../../../api-spec/main/README.md).
It owns explicit resource-recipient relations and coordinates their grants; it does not resolve OIDC
identities or own generic allow/deny policy — those belong to identity and
[authorization](../../authorization/main/README.md).

## Dependency direction

Tagged `scope:grants`: it may depend only on `scope:auth`, `scope:authorization`, `scope:grants`,
and `scope:shared` — never on apps or other sibling domains.

## Data & persistence

Writes `AuthorizationGrant` rows in `apps/opencrane/prisma/schema/authorization.prisma`. Direct
file, chat, and dataset sharing also owns explicit `ResourceShare` and `ResourceShareRecipient`
relations in `apps/opencrane/prisma/schema/grants.prisma`. Resource shares never create hidden
Groups; each recipient relation is paired with a generic Personal-boundary grant.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [groups](../../groups/main/README.md) · [policies](../../policies/main/README.md) · [authorization](../../authorization/main/README.md)
