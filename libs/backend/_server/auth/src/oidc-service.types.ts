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

/** Session auth status returned to the SPA bootstrap logic. */
export interface AuthStatus
{
  /** Effective auth mode for the current server configuration. */
  mode: ManagerAuthMode;

  /** Whether a human session is currently established. */
  authenticated: boolean;

  /** Authenticated user details when logged in through OIDC (with any subclass enrichment). */
  user: (AuthStatusUser & Record<string, unknown>) | null;
}

/** The OIDC client and scope a login should use, resolved for the current request. */
export interface LoginClient
{
  /** The discovered OIDC client configuration to authorize against. */
  config: client.Configuration;

  /** The scope string for the authorization request. */
  scope: string;

  /** The client ID recorded so token exchange uses the same client; omitted for the masters client. */
  clientId?: string;
}
