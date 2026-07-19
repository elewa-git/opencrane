# @opencrane/server/_infra/auth — OIDC login and authorization substrate

The OpenCrane server's identity plumbing: environment-driven OIDC configuration
(`___LoadOidcAuthConfig`), session lifecycle helpers, identity-claim resolution, organisation
membership facts, the `___AuthMiddleware` seam, per-organisation Zitadel login clients (org
scope + ClusterTenant CR lookup), silo derivation from the request host, and the authorization
gates `_RequirePlatformOperator`, `_RequireOrgAdmin`, `_RequireOrgManager`, and
`_RequireBillingAccountForOrgCreate`.

Importing the package also applies the `express-session` `SessionData` augmentation, so
`req.session.authUser` is typed in every consumer. The posture is IAM-first and fail-closed:
gates decide purely from the IdP-verified session, never from request input, and reject with
403 when no session exists — except under explicit dev mode (`_IsDevAuthMode`), the only
fail-open path. A wrong silo guess from the host label yields zero membership rows rather than
a mis-resolution.

It composes into the `apps/opencrane` server and the identity/access backend domains
(`identity`, `cluster-tenants`, `grants`, `mcp`, `providers`, and peers). It does not own the
role model, user records, or any route of its own — it supplies the middleware and gates that
routers mount.

Tagged `type:lib`, `layer:infra`, `scope:auth`: it may depend only on `scope:auth`,
`scope:k8s-api`, and `scope:shared` — never on backend domains or apps.
