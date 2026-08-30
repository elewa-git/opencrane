/**
 * `@opencrane/backend/server/infra/auth` — how the OpenCrane server logs a human in and
 * decides what that human may do.
 *
 * What is in here:
 *   - OIDC settings read from environment variables ({@link ___LoadOidcAuthConfig}).
 *   - The whole browser login flow — redirect, callback, logout ({@link OidcAuthServiceBase}).
 *   - Session cookie helpers (save, regenerate, destroy, safe return-to paths).
 *   - The rule that turns identity-provider claims into the fleet identity-plane
 *     `isPlatformOperator` claim ({@link _ResolveIdentityClaims}) and the `OrgMembership`
 *     lookup that projects organisation summaries ({@link _ResolveOrgMembershipFacts}).
 *   - Request-derived facts: host, silo (ClusterTenant), principal.
 *   - The authentication middleware ({@link ___AuthMiddleware}).
 *
 * A newcomer should read {@link OidcAuthServiceBase} first (the login flow) and then
 * {@link AuthUser} (what ends up in the session cookie).
 *
 * IMPORTANT: importing this package also runs `./session.types.js` for its side effect,
 * and that is what adds `authUser`, `idToken`, and `oidcFlow` to the `express-session`
 * `SessionData` type. Without the import on line 9 `req.session.authUser` stops
 * type-checking in every consumer, so do not remove it as an unused import.
 *
 * @see https://openid.net/specs/openid-connect-core-1_0.html — the OIDC Authorization
 *      Code flow this package implements (login redirect, callback, ID-token claims).
 * @see https://github.com/expressjs/session — `express-session` (^1.19.0), whose
 *      `SessionData` interface this package augments.
 */
import "./session.types";

export type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput, AuthenticatedRequestPrincipal } from "./authenticated-principal-admission.types";
export { ___LoadOidcAuthConfig } from "./oidc-config";
export type { OidcAuthConfig } from "./oidc-config.types";
export { _RequestHost } from "./request-host";
export { _ResolveRequestPrincipal } from "./request-principal";
export type { RequestPrincipal } from "./request-principal.types";
export { _CreateMountedPublicKeySource } from "./mounted-public-key";
export type { MountedPublicKeySource } from "./mounted-public-key.types";
export { _ResolveIdentityClaims, _ReadStringArrayClaim } from "./identity-claims";
export {
  _buildCurrentUrl,
  _buildPostLogoutRedirectUri,
  _buildRedirectUri,
  _destroySession,
  _regenerateSession,
  _sanitizeReturnTo,
  _saveSession,
} from "./session";
export type { AuthUser } from "./session.types";
export {
  _ResolveOrgMembershipFacts,
} from "./org-membership";
export type { OrgMembershipFacts, OrgMembershipRepository, OrgMembershipRow, OwnedOrg } from "./org-membership.types";
export { OidcAuthServiceBase } from "./oidc-service";
export { PrismaOrgMembershipRepository } from "./prisma-org-membership-repository";
export type { AuthStatus, AuthStatusUser, LoginClient, ManagerAuthMode } from "./oidc-service.types";
export { ___AuthMiddleware } from "./auth-middleware";
export * from "./per-org-client";
export type * from "./per-org-client.types";
export * from "./request-silo";
