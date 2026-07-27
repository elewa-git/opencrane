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
needs — the verified user, their groups, whether they are an org admin, and which customer
(**ClusterTenant**) they belong to — resolved server-side from their verified email, never from
anything the browser claims.

Each customer is isolated in its own **silo**. A login on an org's own host authorises against *that*
org's IdP client, so only its own user pool can sign in there.

```
 person clicks "log in"
        │
        ▼
 ┌──────────────────────────────┐
 │   identity  ◄── HERE          │  redirect to IdP → validate callback → start session
 └──────────────────────────────┘
        │  on first login: adopt into org + seed workspace, mirror IdP groups
        ▼
  session established  →  /auth/me hands verified {user, groups, clusterTenant}
        │                 to membership + authorization on every later request
        ▼
  membership → authorization (the allow/deny path)
```

**In this flow:** [membership](../../membership/main/README.md) · [authorization](../../authorization/main/README.md)

**Its role:** it runs *before* any access decision — nothing downstream may act until identity has
produced a verified session. On first sign-in it also does the "missing middle" of onboarding:
adopting the verified user into their organisation as a Member (never downgrading an existing
Owner/Admin) and seeding their personal workspace, and mirroring the groups from their login token
into the silo's stored groups so operator tooling, grants, and audit see the same membership.

Invariant: every identity fact it emits is IdP-verified, not self-asserted — a caller can never
obtain another user's tenant or claim admin rights they were not granted. Adoption and group mirror
are best-effort by contract: a failure there is logged and never breaks the login.

## Public surface

- `OidcAuthService` — the sign-in service: OIDC login, token exchange, claim validation, session
  lifecycle, and the `/auth/me` enrichment that adds the caller's resolved ClusterTenant.
- `___AuthRouter` — the Express routes for session introspection (`/me`) and the OIDC browser flow
  (`/login`, `/callback`, `/logout`).
- `_MirrorGroupsOnLogin` — projects the login token's groups into the silo's stored `Group.members`.
- Workflow contract types from `identity-workflows.types`.

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
