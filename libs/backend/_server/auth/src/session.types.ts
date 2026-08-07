import "express-session";

/**
 * Authenticated human identity cached in an OpenCrane server session. The OIDC login
 * flow populates it and the server authorization gates consume it.
 */
export interface AuthUser
{
  /** Stable subject identifier from the identity provider. */
  sub: string;

  /** Issuer that authenticated the user. */
  issuer: string;

  /** The caller's group memberships from the OIDC groups/roles claims (empty when none). */
  groups: string[];

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
     * The authenticated human identity, established by the OIDC login flow and read by the
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
