# @opencrane/backend/server/iam/grants — inter-user sharing via AuthorizationGrant

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › grants

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers **who is making this request, and are they allowed to do this?** Grants owns the sharing
routes that let a user delegate an entitlement they hold to another user or group.

A **share** is an `AuthorizationGrant` with effect `Allow`: "this recipient may use this resource,
at this scope". People create shares by calling the sharing API (`/api/v1/shares`,
`/api/v1/resource-shares`). The least-privilege gate evaluates the caller's own grants via
`__DecideAuthorization` before writing, so sharing can never escalate privilege. Silo scoping
ensures cross-silo isolation.

```
 user shares a tool / file    POST /api/v1/shares · /resource-shares
        │  (silo-scoped, least-privilege gated)
        ▼
 ┌───────────────────────────────┐
 │   grants   ◄── HERE            │  writes AuthorizationGrant rows
 └───────────────────────────────┘
        │  authorization evaluates grants at runtime
        ▼
  RbacAuthority / __DecideAuthorization resolves access decisions
```

**In this flow:** [authorization](../../authorization/main/README.md) · [groups](../../groups/main/README.md)

Invariant: share creation, listing and revocation derive the sharer from the authenticated
principal resolved by `_ResolveRequestPrincipal`, never from a request-body identity; missing
identity fails with `401`. The API accepts only its explicit scope, recipient and allow semantics.

## Public surface

- The share routes (`routes/shares`, `routes/resource-shares`) and their types — the inter-user and
  direct-resource sharing APIs.
- `_GrantsOpenapiPaths` — the OpenAPI (REST API description) path fragment this domain contributes to the aggregated spec.

## Boundary

Consumed by the server's HTTP composition root and by [api-spec](../../../api-spec/main/README.md).
It writes *entitlement grants*; it does not run the per-request runtime allow/deny with
cryptographic proof — that is [authorization](../../authorization/main/README.md).

## Dependency direction

Tagged `scope:grants`: it may depend only on `scope:auth`, `scope:authorization`, `scope:grants`,
and `scope:shared` — never on apps or other sibling domains.

## Data & persistence

Writes `AuthorizationGrant` rows in `apps/opencrane/prisma/schema/authorization.prisma`. The
`GrantScope` and `GrantSubjectType` enums in `apps/opencrane/prisma/schema/grants.prisma` are
cross-package enums referenced by `Group.scope`, `McpServer.scope`, and
`AgentRevisionScopeAttachment`.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [groups](../../groups/main/README.md) · [policies](../../policies/main/README.md) · [authorization](../../authorization/main/README.md)
