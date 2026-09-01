# @opencrane/backend/server/infra/auth — OIDC login and authorization substrate

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › auth

## What it owns

This library answers, for every incoming HTTP request, **"who is this?"** — the sign-in and
identity-admission layer the OpenCrane server sits behind. It uses **OIDC** (OpenID Connect,
the standard sign-in protocol where an external identity provider vouches for a user) and keeps a
**session** (the server-remembered fact that a browser has logged in, carried in a cookie).

It is the first runtime seam every protected request passes through:

```
 HTTP request  (browser cookie · bearer token · none)
        │
        ▼
 ┌────────────────────────────┐
 │   server/infra/auth  ◄── HERE    │  resolve identity → attach req.session.authUser, or 401/403
 └────────────────────────────┘
        │  authenticated request  (+ membership / silo facts)
        ▼
 server/infra/http router  →  backend domain route
```

**In this flow:** [http](../http/README.md) *(mounts the middleware)* · the IAM (identity and access
management)/tenancy backend domains *(read the resolved identity)*

`___AuthMiddleware` resolves auth in a fixed priority order — public-path bypass, exact configured
OIDC session identity, mandatory local Principal admission, then denial. Principal admission is an
injected IAM port: it must reconcile the verified group claims and exact-resolve the host silo,
issuer, and subject before the middleware attaches `request.authenticatedPrincipal` and enters a
product route. Projection failure returns unavailable and a stale or mismatched projection returns
unauthenticated; neither path calls the product router. Around it the library owns: environment-driven OIDC config (`___LoadOidcAuthConfig`),
session lifecycle helpers (`_saveSession`, `_regenerateSession`, `_destroySession`, safe return-to
sanitising), identity-claim resolution, organisation **membership** presentation facts, a **per-org
login client** seam (each organisation can have its own OIDC settings), and silo resolution from
the request host. It applies an `express-session` type augmentation so `req.session.authUser` is
typed everywhere. Invariant: **fail-closed** — anything missing, malformed, or unverified becomes a
401/403; the server never treats an unauthenticated request as trusted.

## Public surface

- `_AdmitBrowserSession`, `AuthenticatedPrincipalAdmission`, and
  `AuthenticatedPrincipalAdmissionInput` — the shared fail-closed session expiry, exact identity
  tuple, durable Principal admission, and request-attachment boundary used by production and Tier 2
  authentication.
- `___AuthMiddleware` — the production OIDC adapter over that shared browser-session boundary.
- `___LoadOidcAuthConfig`, `OidcAuthConfig`, `_IsDevAuthMode` — OIDC configuration.
- `OidcAuthServiceBase`, `LoginClient`, `AuthStatus` — the login-flow service and per-org login seam.
  Subclasses may declare a post-login admission failure fatal when silently continuing would present
  a signed-in user with false onboarding state. Fatal failures destroy the freshly regenerated
  session before returning the callback error; optional projection work remains best-effort.
- Session helpers + `AuthUser`; `_ResolveIdentityClaims`; `_ResolveOwnedOrgSummaries`,
  `OwnedOrgSummaryFacts`, `OwnedOrgSummaryRepository`, and `PrismaOwnedOrgSummaryRepository`.
- `_ResolveRequestPrincipal`, `RequestPrincipal` — expose the admitted local Principal and
  independently rechecked host silo without importing any backend-domain caller type.
- `_CreateMountedPublicKeySource`, `MountedPublicKeySource` — fail-closed access to an absolute
  projected public-key file, reloaded on each use so Secret rotation takes effect without restart.
- `per-org-client`, `request-silo`, `_RequestHost` — per-organisation clients and host/silo resolution.

## Boundary

Consumed by the `apps/opencrane` server and the IAM, tenancy, and gateway backend domains. It
establishes *who* the caller is; all product permission decisions belong to the central
authorization authority. Backend routers map `RequestPrincipal` into their own caller
contracts, keeping this package independent of business types. It reads config, sessions,
organisation membership, and (optionally) tokens. Its mounted-key source knows only how to reload public material; the consuming
backend authority decides what that key is trusted to verify. It owns no business tables of its own.

`isPlatformOperator` survives only as a fleet identity-plane claim used by
`IdentityAuthority.authenticate` and operator-facing introspection. It never grants a product
action. Product routes must ask `AuthorizationAuthority` for the exact resource and action instead
of evaluating this claim or mounting a claim-based guard.

## Dependency direction

Tagged `scope:auth` (`layer:infra`): it may depend only on `scope:auth`, `scope:k8s-api`, and
`scope:shared` packages — never on backend business domains, the frontend, or app entrypoints.

## Data & persistence

`PrismaOwnedOrgSummaryRepository` reads the verified subject's `OrgMembership` rows and projects
owner and administrator labels for `/auth/me`; that summary never authorizes a route. This package
owns neither the model nor its schema or migrations; clean-database setup stays with the target
baseline under `apps/opencrane/prisma`. Repository failures propagate so callers do not confuse an
unavailable summary source with a successful empty result.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [http](../http/README.md) · [api](../api/README.md)
