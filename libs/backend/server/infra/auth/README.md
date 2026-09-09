# @opencrane/backend/server/infra/auth — browser sign-in and session storage

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › auth

## What it owns

This library answers, for every incoming HTTP request, **"who is this?"** — the sign-in and
identity-admission layer the OpenCrane server sits behind. It uses **OIDC** (OpenID Connect,
the standard sign-in protocol where an external identity provider vouches for a user) and keeps a
**session** (the server-remembered fact that a browser has logged in, carried in a cookie).
Encrypted PostgreSQL sessions let people stay signed in when a server is replaced or a request
reaches another server. The cookie contains a signed identifier, never the stored identity or tokens.

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

The source is grouped into `configuration/` for operator settings, `login/` for the identity-provider
flow, `sessions/` for browser login state, `requests/` for request identity, `organizations/` for
membership presentation, and `keys/` for mounted public-key access. Tests live with their owner.
Consumers continue to import the same public entrypoint, `src/index.ts`.

- `___AuthMiddleware`, `AuthenticatedPrincipalAdmission` — the request authentication middleware and
  its fail-closed durable-identity admission port.
- `___LoadOidcAuthConfig`, `OidcAuthConfig`, `_IsDevAuthMode` — OIDC configuration.
- `OidcAuthServiceBase`, `LoginClient`, `AuthStatus` — the login-flow service and per-org login seam.
  Subclasses may declare a post-login admission failure fatal when silently continuing would present
  a signed-in user with false onboarding state. Fatal failures destroy the freshly regenerated
  session before returning the callback error; optional projection work remains best-effort.
- `PrismaOidcSessionUnitOfWork` and `OidcSessionRepository` — encrypted browser-session storage,
  current-revision saves, logout markers and bounded expiry cleanup.
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
backend authority decides what that key is trusted to verify. It owns no business authorization tables of its own; its technical session table stores login state.

`isPlatformOperator` survives only as a fleet identity-plane claim used by
`IdentityAuthority.authenticate` and operator-facing introspection. It never grants a product
action. Product routes must ask `AuthorizationAuthority` for the exact resource and action instead
of evaluating this claim or mounting a claim-based guard.

## Dependency direction

Tagged `scope:auth` (`layer:infra`): it may depend only on `scope:auth`, `scope:k8s-api`, and
`scope:shared` packages — never on backend business domains, the frontend, or app entrypoints.

## Data & persistence

`PrismaOwnedOrgSummaryRepository` reads the verified subject's `OrgMembership` rows and projects
owner and administrator labels for `/auth/me`; that summary never authorizes a route. This package does not own the membership model. Its own `OidcSession` model lives in
`prisma/schema/oidc-sessions.prisma`; installation uses the reviewed fresh target baseline. Repository failures propagate so callers do not confuse an
unavailable summary source with a successful empty result.

## Runtime & config

OIDC requires the persistent repository and a stable `OIDC_SESSION_SECRET` with at least 32 bytes.
Use a randomly generated secret and preserve it across replicas and replacement. A purpose-separated
key encrypts ID tokens, PKCE state and identity fields; replacing the secret invalidates sessions.
`OIDC_SESSION_MAX_AGE_SECONDS` defaults to 12 hours and must be positive and at most seven days.
A new identifier freezes its deadline. Configuration changes affect new identifiers; existing
ones retain their original deadline so another replica can still log them out. Anonymous sign-in flows last
at most ten minutes; authenticated sessions also stop at verified ID-token expiry. Cookie touch
never extends server-side validity. Reads still run the current membership and host/issuer checks.

Logout clears the encrypted content and retains a marker through identifier expiry plus the supported
60-second maximum clock difference between replicas. A delayed first save or stale revision cannot
restore it. Active servers prune at most 100 expired identifiers per minute through the existing
database; idle servers need no background timer. A database outage
fails session reads and writes rather than falling back to local memory.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [http](../http/README.md) · [api](../api/README.md)
