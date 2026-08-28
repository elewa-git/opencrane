import "express-session";

/**
 * The logged-in human, as stored in the session cookie store.
 *
 * Written once by the selected browser-login service and read afterwards by the matching
 * authentication middleware, the two route guards, and `_ResolveRequestPrincipal`. Treat it as
 * a cache of what was true AT LOGIN: nothing here is refreshed while the session lives.
 *
 * The one exception is {@link AuthUser.isOrgAdmin}, which `/auth/me` recomputes on every
 * call by OR-ing the stored value with current `OrgMembership` rows. So a route guard
 * reading the session may still say "not an org admin" for a user whom `/auth/me` already
 * reports as one, until they log in again or a login hook rewrites the session.
 *
 * @see https://github.com/expressjs/session — the `express-session` store that holds
 *      this object; the augmentation at the bottom of this file is what types it.
 */
export interface AuthUser
{
  /** Stable subject identifier from the selected authentication authority. */
  sub: string;

  /** Issuer that authenticated the user. */
  issuer: string;

  /** The caller's verified group claims, or an empty set for the fixed Tier 3 identity. */
  groups: string[];

  /** Silo whose selected login authority and standalone admission bound this login. */
  siloId?: string;

  /** Session authorization expiry that bounds how long cached authorization facts remain usable. */
  authorizationExpiresAt: string;

  /**
   * Whether the caller is a platform operator: their groups intersect
   * `OPENCRANE_PLATFORM_OPERATOR_GROUPS`, OR their VERIFIED email equals the per-cluster
   * `OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL`. Both inputs empty ⇒ false (fail-closed).
   * Introspection only — the API stays the enforcement point.
   */
  isPlatformOperator: boolean;

  /**
   * Whether the caller is an organisation admin, as resolved AT LOGIN (groups intersecting
   * `OPENCRANE_ORG_ADMIN_GROUPS`, or platform-operator superset). `/auth/me` re-derives the
   * EFFECTIVE flag fresh by OR-ing this with membership (owner/admin of ≥1 org). Empty
   * config + no membership ⇒ false (fail-closed).
   */
  isOrgAdmin: boolean;

  /** Human-readable email address when available. */
  email?: string;

  /** Whether the selected authentication authority verified the email. */
  emailVerified?: boolean;

  /** Display name when available. */
  name?: string;

  /** Avatar image URL when available. */
  picture?: string;

  /** ISO timestamp of when the local session was established. */
  authenticatedAt: string;
}

declare module "express-session"
{
  interface SessionData
  {
    /**
     * The authenticated identity established by the selected browser-login flow and read by the
     * authorization gates (see {@link AuthUser}).
     */
    authUser?: AuthUser;

    /**
     * ID token captured at login; used as `id_token_hint` when building the IdP's
     * end_session URL for RP-initiated logout. Never read for authorization.
     */
    idToken?: string;

    /**
     * In-flight OIDC login state (PKCE + replay protection). `clientId` records the
     * per-org OIDC client the authorization request used so `completeLogin` exchanges the
     * code against the same client. Per-org login sets it; a single-client flow leaves it
     * unset and the base flow falls back to the masters client.
     */
    oidcFlow?: {
      codeVerifier: string;
      state: string;
      nonce: string;
      returnTo: string;
      clientId?: string;
    };
  }
}

// This module exists only for the ambient `express-session` augmentation above; importing
// it for its side effect (in the package barrel) is what brings the augmentation into scope.
export {};
