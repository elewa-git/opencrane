# @opencrane/backend/server/tenancy/cluster-tenants — organisation boundary

> [backend](../../../../README.md) › [server](../../../README.md) › [tenancy](../../README.md) › cluster-tenants

## What it owns

A **ClusterTenant** identifies one customer organisation and the silo that contains its OpenCrane
data and services. This package supplies the authorization guard that prevents callers from
mutating resources owned by another organisation.

```
 authenticated organisation request
                    │ targeted resource scope
                    ▼
 ┌─────────────────────────────────────┐
 │ cluster-tenants  ◄── HERE            │
 │ resolve caller membership           │
 └───────────────┬─────────────────────┘
                 │ trusted tenant or none
                 ▼
       authenticated domain capabilities
```

Caller scope is derived from verified identity and stored membership, never from a caller-supplied
organisation name. Missing, ambiguous, or mismatched evidence produces a denial.

## Public surface

- `_ResolveCallerClusterTenant` — resolves an authenticated subject to one trusted organisation
  membership for identity projection.

## Boundary

Consumed by identity and organisation-scoped composition. It resolves membership identity facts;
the central authorization authority decides product permissions. It does not own agent, run,
provisioning, or provider behaviour.

## Dependency direction

Tagged `scope:cluster-tenants`: it may depend only on `scope:auth`, `scope:cluster-tenants`,
`scope:k8s-api`, and `scope:shared` — never on apps or sibling domains.

## Data & persistence

Organisation membership is stored in PostgreSQL and supplies the subject-to-tenant projection.

## See also

- Parent index: [tenancy](../../README.md)
- Identity and membership: [identity](../../../iam/identity/main/README.md) ·
  [membership](../../../iam/membership/main/README.md)
