/**
 * `@opencrane/backend/server/infra/auth` — how the OpenCrane server logs a human in and
 * attaches the verified identity to a request.
 *
 * What is in here:
 *   - OIDC settings read from environment variables ({@link ___LoadOidcAuthConfig}).
 *   - The whole browser login flow — redirect, callback, logout ({@link OidcAuthServiceBase}).
 *   - Session cookie helpers (save, regenerate, destroy, safe return-to paths).
 *   - The rule that turns identity-provider claims into the fleet identity-plane
 *     `isPlatformOperator` claim ({@link _ResolveIdentityClaims}) and the `OrgMembership`
 *     lookup that projects organisation summaries ({@link _ResolveOwnedOrgSummaries}).
 *   - Request-derived facts: host, silo (ClusterTenant), principal.
 *   - The authentication middleware ({@link ___AuthMiddleware}).
 *
 * A newcomer should read {@link OidcAuthServiceBase} first (the login flow) and then
 * {@link AuthUser} (what the server stores in the authenticated session).
 *
 * The `./sessions/session.types` import adds `authUser`, `idToken`, and `oidcFlow` to
 * the `express-session` `SessionData` type. The public barrel loads this augmentation
 * so consumers can type-check authenticated requests without importing session internals.
 *
 * @see https://openid.net/specs/openid-connect-core-1_0.html — the OIDC Authorization
 *      Code flow this package implements (login redirect, callback, ID-token claims).
 * @see https://github.com/expressjs/session — `express-session` (^1.19.0), whose
 *      `SessionData` interface this package augments.
 */
import "./sessions/session.types";

export type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput, AuthenticatedRequestPrincipal } from "./requests/authenticated-principal-admission.types";
export { ___LoadOidcAuthConfig } from "./configuration/oidc-config";
export type { OidcAuthConfig } from "./configuration/oidc-config.types";
export { _RequestHost } from "./requests/request-host";
export { _ResolveRequestPrincipal } from "./requests/request-principal";
export type { RequestPrincipal } from "./requests/request-principal.types";
export { _CreateMountedPublicKeySource } from "./keys/mounted-public-key";
export type { MountedPublicKeySource } from "./keys/mounted-public-key.types";
export { _ResolveIdentityClaims, _ReadStringArrayClaim } from "./login/identity-claims";
export {
  _buildCurrentUrl,
  _buildPostLogoutRedirectUri,
  _buildRedirectUri,
  _destroySession,
  _regenerateSession,
  _sanitizeReturnTo,
  _saveSession,
} from "./sessions/session";
export type { AuthUser } from "./sessions/session.types";
export {
  _ResolveOwnedOrgSummaries,
} from "./organizations/org-membership";
export type { OwnedOrgSummaryFacts, OwnedOrgSummaryRepository, OwnedOrgSummaryRow, OwnedOrg } from "./organizations/org-membership.types";
export { OidcAuthServiceBase } from "./login/oidc-service";
export { PrismaOwnedOrgSummaryRepository } from "./organizations/prisma-owned-org-summary-repository";
export type { AuthStatus, AuthStatusUser, LoginClient, ManagerAuthMode } from "./login/oidc-service.types";
export { ___AuthMiddleware } from "./requests/auth-middleware";
export * from "./login/per-org-client";
export type * from "./login/per-org-client.types";
export * from "./requests/request-silo";

export { PrismaOidcSessionUnitOfWork } from "./sessions/prisma-oidc-session-repository";
export type { OidcSessionRepository } from "./sessions/oidc-session-repository.types";
