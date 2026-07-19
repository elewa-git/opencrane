# @opencrane/backend/server/identity — silo OIDC identity workflows

Owns the silo's login-time identity behaviour on top of the shared OIDC base in
`@opencrane/server/_infra/auth`. `OidcAuthService` adds the two silo-specific seams: per-org login
(a host `<org>.<base>` or vanity domain that maps to a provisioned ClusterTenant authenticates
against that org's own Zitadel client and org-restriction scope, falling through to the masters
client otherwise) and `/auth/me` enrichment, where the caller's ClusterTenant is resolved
server-side from their verified email — never from a self-asserted claim.

Two post-login workflows hang off it. `_AdoptMemberOnLogin` treats a successful per-org login as
proof of membership, adopts `{ clusterTenant, subject, role: Member }` without ever downgrading an
existing Owner/Admin, writes through to the fleet when one exists (standalone silos write
locally), and seeds the member's workspace; it is best-effort by contract so adoption can never
break a login. `_MirrorGroupsOnLogin` projects `group:<scope>:<name>` token claims into persisted
`Group.members`, pruning stale convention-group entries while never touching operator-curated
groups. `___AuthRouter` exposes the public surface (`/me`, `/login`, `/callback`, `/logout`,
`/pod-token`), mounted before the auth middleware with per-handler enforcement.

Composed by the OpenCrane server (`apps/opencrane/src/index.ts`). Tagged `scope:identity`: it may
depend only on `scope:auth`, `scope:cluster-tenants`, `scope:connections`, `scope:projection`, and
`scope:shared` — never on apps or other domains.
