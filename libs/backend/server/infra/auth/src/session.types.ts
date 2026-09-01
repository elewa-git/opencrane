import "express-session";

/**
 * Carries the logged-in human in the server-owned request session.
 *
 * Production OIDC and Tier 3 write this through their login-backed session stores. Tier 2 builds
 * the same shape after checking the request host and origin, so the shared Principal admission can
 * enforce the same identity tuple and expiry contract before product routes run.
 *
 * @see https://github.com/expressjs/session/tree/v1.19.0 — the session store used by production
 *      and Tier 3; its augmentation at the bottom of this file also types Tier 2's request value.
 */
export interface AuthUser
{
  /** Stable subject identifier from the identity provider. */
  sub: string;

  /** Issuer that authenticated the user. */
  issuer: string;

  /** The caller's group memberships from the OIDC groups/roles claims (empty when none). */
  groups: string[];

  /** Silo whose OIDC client or standalone admission bound this login; absent until post-login admission succeeds. */
  siloId?: string;

  /** Expiry that bounds how long this session identity remains usable for Principal admission. */
  authorizationExpiresAt: string;

  /**
   * Whether the caller is a platform operator: their groups intersect
   * `OPENCRANE_PLATFORM_OPERATOR_GROUPS`, OR their VERIFIED email equals the per-cluster
   * `OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL`. Both inputs empty ⇒ false (fail-closed).
   * Introspection only — the API stays the enforcement point.
   */
  isPlatformOperator: boolean;

  /** Human-readable email address when available. */
  email?: string;

  /** Whether the provider marked the email as verified. */
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
     * The authenticated human identity established by the active login or development adapter and
     * read by the authorization gates (see {@link AuthUser}).
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
