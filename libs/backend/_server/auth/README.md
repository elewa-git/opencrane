# @opencrane/backend/_server/auth — OIDC login and authorization substrate

> [backend](../../README.md) › [_server](../README.md) › auth

## What it owns

This library answers, for every incoming HTTP request, **"who is this, and are they allowed in?"** —
the sign-in and gatekeeping layer the OpenCrane server sits behind. It uses **OIDC** (OpenID Connect,
the standard sign-in protocol where an external identity provider vouches for a user) and keeps a
**session** (the server-remembered fact that a browser has logged in, carried in a cookie).

It is the first runtime seam every protected request passes through:

```
 HTTP request  (browser cookie · bearer token · none)
        │
        ▼
 ┌────────────────────────────┐
 │   _server/auth  ◄── HERE    │  resolve identity → attach req.session.authUser, or 401/403
 └────────────────────────────┘
        │  authenticated request  (+ membership / silo facts)
        ▼
 _server/http router  →  backend domain route
```

**In this flow:** [http](../http/README.md) *(mounts the middleware)* · the IAM (identity and access
management)/tenancy backend domains *(read the resolved identity)*

`___AuthMiddleware` resolves auth in a fixed priority order — public-path bypass, OIDC session,
env-var token (for CI), per-user database token, then a dev-mode bypass only when nothing is
configured. Around it the library owns: environment-driven OIDC config (`___LoadOidcAuthConfig`),
session lifecycle helpers (`_saveSession`, `_regenerateSession`, `_destroySession`, safe return-to
sanitising), identity-claim resolution, organisation **membership** facts (which orgs a user belongs
to / owns), a **per-org login client** seam (each organisation can have its own OIDC settings), silo
(one tenant's isolated running environment) resolution from the request host, and the authorization gates `_RequirePlatformOperator` /
`_RequireOrgAdmin`. It applies an `express-session` type augmentation so `req.session.authUser` is
typed everywhere. Invariant: **fail-closed** — anything missing, malformed, or unverified becomes a
401/403; the server never treats an unauthenticated request as trusted.

## Public surface

- `___AuthMiddleware`, `AccessTokenReader` — the request authentication middleware and its token-reader port.
- `___LoadOidcAuthConfig`, `OidcAuthConfig`, `_IsDevAuthMode` — OIDC configuration.
- `OidcAuthServiceBase`, `LoginClient`, `AuthStatus` — the login-flow service and per-org login seam.
  Subclasses may declare a post-login admission failure fatal when silently continuing would present
  a signed-in user with false onboarding state. Fatal failures destroy the freshly regenerated
  session before returning the callback error; optional projection work remains best-effort.
- Session helpers + `AuthUser`; `_ResolveIdentityClaims`; `_ResolveOrgMembershipFacts`,
  `OrgMembershipFacts`, `OrgMembershipRepository`, and `PrismaOrgMembershipRepository`.
- `_ResolveRequestPrincipal`, `RequestPrincipal` — derive one authenticated subject, host-selected
  silo, and organisation-admin flag without importing any backend-domain caller type.
- `_CreateMountedPublicKeySource`, `MountedPublicKeySource` — fail-closed access to an absolute
  projected public-key file, reloaded on each use so Secret rotation takes effect without restart.
- `_RequirePlatformOperator`, `_RequireOrgAdmin` — authorization gates.
- `per-org-client`, `request-silo`, `_RequestHost` — per-organisation clients and host/silo resolution.

## Boundary

Consumed by the `apps/opencrane` server and the IAM, tenancy, and gateway backend domains. It
establishes *who* the caller is and coarse gates (operator/admin); fine-grained per-action decisions
belong to the authorization model. Backend routers map `RequestPrincipal` into their own caller
contracts, keeping this package independent of business types. It reads config, sessions,
organisation membership, and (optionally) tokens. Its mounted-key source knows only how to reload public material; the consuming
backend authority decides what that key is trusted to verify. It owns no business tables of its own.

## Dependency direction

Tagged `scope:auth` (`layer:infra`): it may depend only on `scope:auth`, `scope:k8s-api`, and
`scope:shared` packages — never on backend business domains, the frontend, or app entrypoints.

## Data & persistence

`PrismaOrgMembershipRepository` reads only owner/admin rows from the app-owned `OrgMembership`
model. This package owns neither that model nor its schema or migrations; clean-database setup stays
with the target baseline under `apps/opencrane/prisma`. Repository failures propagate so callers do
not confuse an unavailable authority source with a successful empty membership result.

## See also

- Parent index: [_server](../README.md) · [backend libraries](../../README.md)
- Siblings: [http](../http/README.md) · [api](../api/README.md) · [obot-custody](../obot-custody/README.md)
