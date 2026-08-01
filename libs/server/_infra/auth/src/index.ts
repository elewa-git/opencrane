/**
 * `@opencrane/server/_infra/auth` — the OpenCrane server's OIDC login and authorization
 * substrate: environment-driven configuration, session lifecycle, per-organization login
 * seams, identity claims, membership facts, middleware, and authorization gates.
 *
 * Importing this package also applies the `express-session` `SessionData` augmentation
 * (see ./session.types) so `req.session.authUser` is typed in every consumer.
 */
import "./session.types.js";

export { ___LoadOidcAuthConfig } from "./oidc-config.js";
export type { OidcAuthConfig } from "./oidc-config.types.js";
export { _RequestHost } from "./request-host.js";
export { _ResolveRequestPrincipal } from "./request-principal.js";
export type { RequestPrincipal } from "./request-principal.types.js";
export { _CreateMountedPublicKeySource } from "./mounted-public-key.js";
export type { MountedPublicKeySource } from "./mounted-public-key.types.js";
export { _ResolveIdentityClaims, _ReadStringArrayClaim } from "./identity-claims.js";
export {
  _buildCurrentUrl,
  _buildPostLogoutRedirectUri,
  _buildRedirectUri,
  _destroySession,
  _regenerateSession,
  _sanitizeReturnTo,
  _saveSession,
} from "./session.js";
export type { AuthUser } from "./session.types.js";
export {
  _ResolveOrgMembershipFacts,
} from "./org-membership.js";
export type { OrgMembershipFacts, OrgMembershipReader, OrgMembershipRow, OwnedOrg } from "./org-membership.types.js";
export { OidcAuthServiceBase } from "./oidc-service.js";
export type { AuthStatus, AuthStatusUser, LoginClient, ManagerAuthMode } from "./oidc-service.types.js";
export { ___AuthMiddleware } from "./auth-middleware.js";
export { _RequirePlatformOperator } from "./require-platform-operator.js";
export { _RequireOrgAdmin } from "./require-org-admin.js";
export {
  _RequireBillingAccountForOrgCreate,
  _RequireOrgManager,
} from "./cluster-tenant-org-admin.js";
export type { BillingAccountReader, OrgManagerReader } from "./cluster-tenant-org-admin.types.js";
export * from "./per-org-client.js";
export type * from "./per-org-client.types.js";
export * from "./request-silo.js";
