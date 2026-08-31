# @opencrane/backend/server/iam/identity — browser sign-in to server identity facts

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › identity

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers **who is making this request, and are they allowed to do this?** Identity owns the very first
half: turning a person signing in through their browser into trustworthy identity facts the rest of
the server can rely on.

OpenCrane does not store passwords. Sign-in is delegated to an outside **identity provider** (an
"IdP" — the login service that actually checks the password, here Zitadel), using the standard
**OIDC** browser flow (*OpenID Connect*, the protocol for "log in with…"). This package runs that
flow: it redirects the browser to the IdP, receives the signed proof of who logged in when they come
back, validates it, and starts a server-side session. It then derives the facts every later request
needs — the verified user, their groups, their current central product capabilities, and which customer
(**ClusterTenant**) they belong to — resolved server-side from their stable verified subject, never
from anything the browser claims.

Each customer is isolated in its own **silo**. A login on an org's own host authorises against *that*
org's IdP client, so only its own user pool can sign in there.

```
 person clicks "log in"
        │
        ▼
 ┌──────────────────────────────┐
 │   identity  ◄── HERE          │  redirect to IdP → validate callback → start session
 └──────────────────────────────┘
        │  optional group mirror + standalone first-owner admission
        ▼
  session established  →  /auth/me hands verified identity + central capability hints
        │                 to membership + authorization on every later request
        ▼
  membership → authorization (the allow/deny path)
```

**In this flow:** [membership](../../membership/main/README.md) · [authorization](../../authorization/main/README.md)

**Its role:** it runs *before* any access decision — nothing downstream may act until identity has
produced a verified session. In a standalone silo, the deploy contract may name one bootstrap email.
Only that email's explicitly verified OIDC identity can atomically claim the local active Owner row;
the durable key is the stable `sub`, not the email. The deployment engine pins the silo's OIDC
issuer once this contract exists, because an OIDC subject is issuer-scoped. The application supplies
an audit adapter, which records an accepted claim in that same serializable transaction without making
identity depend directly on the audit domain. A claimed owner does not create a personal workspace or
relax signed runtime-membership admission — those are separate authorities. The package
also reconciles stable `group:<Group.id>` claims into normalized direct membership for groups marked
as externally managed. It never creates a group from a claim, treats unknown IDs as non-authoritative,
and never prunes membership in locally managed groups.

Invariant: every identity fact it emits is IdP-verified, not self-asserted — a caller can never
obtain another user's tenant or claim admin rights they were not granted. The login callback's
initial group mirror is best-effort, but every later product request must repeat reconciliation and
exact Principal resolution through `PrismaAuthenticatedPrincipalAdmissionUnitOfWork`; persistence
failure, missing projection, or an identity-tuple mismatch denies the request. A configured first-owner claim fails closed when the slot is still empty but the
identity is ineligible, or when persistence or auditing fails. Once another Owner has claimed the
slot, an ordinary verified identity keeps its session so the separately guarded signed-invitation
acceptance route can establish membership; it gains no Owner or administrator fact from login.

## Public surface

- `OidcAuthService` — the sign-in service: OIDC login, token exchange, claim validation, session
  lifecycle, and the `/auth/me` enrichment that adds the caller's resolved ClusterTenant.
- `___AuthRouter` — the Express routes for session introspection (`/me`) and the OIDC browser flow
  (`/login`, `/callback`, `/logout`).
- `PrismaAuthenticatedPrincipalAdmissionUnitOfWork` — atomically reconciles the verified claim set,
  exact-resolves the durable Principal, and projects `organization:administer` through the central
  authorization authority for `/auth/me`.
- `PrismaAuthenticatedPrincipalDirectoryUnitOfWork` — resolves the exact stored Principal for a
  verified `{siloId, issuer, subject}` tuple.
- `StandaloneFirstUserAdmissionConfig`, `StandaloneFirstUserAdmissionAuditPort` — composition
  contracts that configure the optional standalone first-owner claim.

The OIDC service keeps login group projection and standalone first-owner admission as internal
steps. They are not package entry points because the login flow coordinates their verified inputs,
transaction boundaries, and failure behavior.

## Boundary

Consumed by the server's HTTP composition root, which mounts `___AuthRouter` before the auth
middleware (these routes are public and enforce their own checks per handler). It owns identity, not
authorisation — it produces the verified facts, and separate packages decide access. Fail-closed:
unverified or ambiguous identity yields no session or an anonymous one, never a trusted one.

## Dependency direction

Tagged `scope:identity`: it may depend only on `scope:auth` (the shared OIDC base), `scope:cluster-tenants`,
`scope:connections`, `scope:projection`, `scope:identity`, and `scope:shared` — never on apps.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [membership](../../membership/main/README.md) · [authorization](../../authorization/main/README.md) · [groups](../../groups/main/README.md)
