# @opencrane/backend/server/infra/auth — browser login and authorization boundary

> [backend](../../../README.md) › [server](../../README.md) › [infra](../README.md) › auth

## What it owns

This library answers, for every incoming HTTP request, **"who is this, and are they allowed in?"** —
the sign-in and gatekeeping layer the OpenCrane server sits behind. Production uses **OIDC** (OpenID
Connect, the standard sign-in protocol where an external identity provider vouches for a user).
The disposable Tier 3 profile instead accepts only its startup-selected development identity after
the loopback proxy proves it owns a fresh per-run secret. Both modes keep a **session** (the
server-remembered fact that a browser has logged in, carried in a signed cookie).

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
sanitising), identity-claim resolution, organisation **membership** facts (which orgs a user belongs
to / owns), a **per-org login client** seam (each organisation can have its own OIDC settings), silo
(one tenant's isolated running environment) resolution from the request host, and the authorization gates `_RequirePlatformOperator` /
`_RequireOrgAdmin`. It applies an `express-session` type augmentation so `req.session.authUser` is
typed everywhere. Invariant: **fail-closed** — anything missing, malformed, or unverified becomes a
401/403; the server never treats an unauthenticated request as trusted.

## Public surface

- `___AuthMiddleware`, `AuthenticatedPrincipalAdmission` — the request authentication middleware and
  its fail-closed durable-identity admission port.
- `___DevelopmentAuthMiddleware`, `AuthenticatedPrincipalAdmissionInput` — Tier 3's exact
  issuer/silo/subject session gate and durable Principal admission boundary.
- `___CreateBrowserSessionMiddleware`, `BrowserSessionConfig` — the shared signed-session mechanism
  used by production OIDC and disposable Tier 3 authentication.
- `___LoadOidcAuthConfig`, `OidcAuthConfig` — OIDC configuration.
- `OidcAuthServiceBase`, `LoginClient`, `AuthStatus` — the login-flow service and per-org login seam.
  Subclasses may declare a post-login admission failure fatal when silently continuing would present
  a signed-in user with false onboarding state. Fatal failures destroy the freshly regenerated
  session before returning the callback error; optional projection work remains best-effort.
- Session helpers + `AuthUser`; `_ResolveIdentityClaims`; `_ResolveOrgMembershipFacts`,
  `OrgMembershipFacts`, `OrgMembershipRepository`, and `PrismaOrgMembershipUnitOfWork`.
- `_ResolveRequestPrincipal`, `RequestPrincipal` — expose the admitted local Principal, independently
  rechecked host silo, and organisation-admin flag without importing any backend-domain caller type.
- `_CreateMountedPublicKeySource`, `MountedPublicKeySource` — fail-closed access to an absolute
  projected public-key file, reloaded on each use so Secret rotation takes effect without restart.
- `_RequirePlatformOperator`, `_RequireOrgAdmin` — authorization gates.
- `per-org-client`, `request-silo`, `_RequestHost` — per-organisation clients and host/silo resolution.

## Boundary

Consumed by the `apps/opencrane` server and the IAM, tenancy, and gateway backend domains. Tier 3's
proxy proof authenticates the loopback coordinator, not a human; only the development composition
root may turn it into the fixed identity and only after exact durable Principal admission. It
establishes *who* the caller is and coarse gates (operator/admin); fine-grained per-action decisions
belong to the authorization model. Backend routers map `RequestPrincipal` into their own caller
contracts, keeping this package independent of business types. It reads config, sessions,
organisation membership, and (optionally) tokens. Its mounted-key source knows only how to reload public material; the consuming
backend authority decides what that key is trusted to verify. It owns no business tables of its own.

## Dependency direction

Tagged `scope:auth` (`layer:infra`): it may depend only on `scope:auth`, `scope:k8s-api`, and
`scope:shared` packages — never on backend business domains, the frontend, or app entrypoints.

## Data & persistence

`PrismaOrgMembershipUnitOfWork` opens the read transaction and delegates only its exact binding to
`PrismaOrgMembershipRepository`, which reads active owner/admin rows from the app-owned
`OrgMembership` model. This package owns neither that model nor its schema or migrations; clean-database setup stays
with the target baseline under `apps/opencrane/prisma`. Repository failures propagate so callers do
not confuse an unavailable authority source with a successful empty membership result.

## See also

- Parent index: [infra](../README.md) · [backend libraries](../../../README.md)
- Siblings: [http](../http/README.md) · [api](../api/README.md)
