import type * as client from "openid-client";

import type { OwnedOrg } from "./org-membership.types.js";
import type { AuthUser } from "./session.types.js";

/** Auth mode exposed to the UI so it can decide whether login is required. */
export type ManagerAuthMode = "development" | "oidc";

/**
 * Authenticated user as returned by `/auth/me`: the cached session identity plus the
 * membership-derived `ownedOrgs`. Subclasses may enrich it with extra fields.
 */
export interface AuthStatusUser extends AuthUser
{
  /**
   * The organisations the caller owns or administers, derived fresh from `OrgMembership`
   * (owner/admin only). Empty when the caller administers no org.
   */
  ownedOrgs: OwnedOrg[];
}

/**
 * The `/auth/me` response: what the browser app reads at startup to decide whether to show
 * the application or send the user to log in.
 *
 * Produced only by `OidcAuthServiceBase.getStatus`. `user` is null whenever
 * `authenticated` is false, and `mode` is `development` on a server with no OIDC
 * configuration, which tells the app not to offer login at all.
 */
export interface AuthStatus
{
  /** Effective auth mode for the current server configuration. */
  mode: ManagerAuthMode;

  /** Whether a human session is currently established. */
  authenticated: boolean;

  /** Authenticated user details when logged in through OIDC (with any subclass enrichment). */
  user: (AuthStatusUser & Record<string, unknown>) | null;
}

/**
 * What `resolveLoginClient` returns: which OIDC client a login authorizes against, and
 * with which scope.
 *
 * Omitting {@link LoginClient.clientId} means "the masters client". Setting it makes
 * `buildLoginUrl` record that client_id in the session, so `completeLogin` exchanges the
 * code against the same client — a per-organisation override must set it, or the exchange
 * will use the wrong client and fail.
 */
export interface LoginClient
{
  /** The discovered OIDC client configuration to authorize against. */
  config: client.Configuration;

  /** The scope string for the authorization request. */
  scope: string;

  /** The client ID recorded so token exchange uses the same client; omitted for the masters client. */
  clientId?: string;
}
