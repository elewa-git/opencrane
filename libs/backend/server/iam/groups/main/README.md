# @opencrane/backend/server/iam/groups — named sets of people you can grant access to at once

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › groups

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers **who is making this request, and are they allowed to do this?** Groups owns the idea of a
named set of people — a team, a department, a project — so that access can be given to the whole set
at once instead of one person at a time.

A group is a reusable *subject* that authorization may point at: instead of naming Ana, Ben, and Cara
separately, policy can name the design-team group. A group may also name a parent group, which lets
operators describe a hierarchy without putting that structure into identity-provider claims. A null
parent marks a hierarchy root. The parent is organization metadata; direct membership does not flow
up or down the tree. This package owns the operator-facing group management API (`/api/v1/groups`)
and normalized direct membership rows. Every group records whether Zitadel login claims or OpenCrane
operators own those rows, so one authority never overwrites the other.

```
 identity mirrors a person's login groups  ──┐
 operator curates groups via /api/v1/groups ─┤
        ▼                                     ▼
 ┌───────────────────────────────┐
 │   groups   ◄── HERE            │  store named sets + their members
 └───────────────────────────────┘
        │  authorization may use the group as a subject
        ▼
  authorization evaluates the separately owned entitlement
```

**In this flow:** [identity](../../identity/main/README.md) · [authorization](../../authorization/main/README.md)

Invariant: a group is a silo-bound named set of direct Principal memberships with optional hierarchy
metadata. It neither inherits membership or grants from its parent nor makes access decisions. The
database rejects hierarchy cycles and refuses to delete a parent while it still has children.
Authorization grants are created and evaluated by their owning domains. Mounted at `/api/v1/groups`.

## Public surface

- `groupsRouter` and its route types — the `/api/v1/groups` management API.
- The group logic in `core/groups.logic` — silo-bound hierarchy and normalized local membership create, update, delete, and response shapes.
- `_GroupsOpenapiPaths` and `_GroupsOpenapiSchemas` — the OpenAPI paths and response schemas this domain contributes to the aggregated spec.

## Boundary

Consumed by the server's HTTP composition root and by [api-spec](../../../api-spec/main/README.md).
It owns group definitions and normalized direct memberships. It deliberately does not persist or
resolve effective access. Those entitlements belong to [authorization](../../authorization/main/README.md).

## Dependency direction

Tagged `scope:groups`: it may depend on its own scope, shared contracts, the authentication scope that
supplies the organisation-admin route guard, and the HTTP scope's validated-body adapter. It never
imports an app or another IAM domain's persistence or policy decisions.

## Data & persistence

Owns `Group`, `Principal`, and `GroupMembership` plus the parent-child relation in
`apps/opencrane/prisma/schema/groups.prisma`. A Principal is keyed by silo, issuer, and OIDC subject;
email and display name are profile fields, never identity keys.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [authorization](../../authorization/main/README.md) · [identity](../../identity/main/README.md) · [policies](../../policies/main/README.md)
