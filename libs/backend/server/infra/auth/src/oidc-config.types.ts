/**
 * Everything the OIDC login flow needs, read from environment variables once and then
 * treated as read-only.
 *
 * Built only by {@link ___LoadOidcAuthConfig}, which snapshots `process.env`; the values
 * here are therefore fixed for the life of the process (or, in tests, for the life of the
 * object). Two fields are computed rather than copied: {@link enabled} (is any OIDC
 * variable set at all) and {@link cookieSecure} (production forces HTTPS-only cookies).
 *
 * Every allowlist field defaults to EMPTY and empty means "grants nothing", so a missing
 * variable can never widen access.
 *
 * @see https://openid.net/specs/openid-connect-core-1_0.html — the meaning of `issuer`,
 *      `client_id`, `redirect_uri`, and `scope` below.
 */
export interface OidcAuthConfig
{
  /**
   * Whether browser login is possible. Computed, not read from a variable: true when the
   * issuer, client id, redirect URI, and session secret are all present. When none of
   * them is set this is false and the server runs in development mode; when only some are
   * set {@link ___LoadOidcAuthConfig} throws instead of returning false.
   */
  enabled: boolean;

  /** Issuer URL used for OIDC discovery. */
  issuerUrl: string;

  /** Registered OAuth client identifier. */
  clientId: string;

  /**
   * Client secret, when this deployment registered a confidential client. Absent for the
   * public per-organisation clients, which authenticate the code exchange with PKCE
   * instead of a secret.
   */
  clientSecret?: string;

  /**
   * The callback URI registered with the identity provider. Only its PATH is used at
   * request time: the origin is rebuilt from the host the request arrived on, so a
   * deployment serving several hosts returns each user to the host they logged in from
   * (see `_buildRedirectUri`). The provider must allow every resulting URL.
   */
  redirectUri: string;

  /**
   * Optional post-logout redirect URI for OIDC RP-Initiated Logout. Sent as
   * `post_logout_redirect_uri` to the IdP's `end_session_endpoint` so the IdP
   * returns the user-agent here after destroying the upstream session. Empty
   * when unset, in which case `/auth/logout` still tears down the local session
   * but returns no end-session URL (the browser stays put). The origin is
   * re-derived per request from the host header so multi-host (`<org>.<base>`)
   * deployments end up back on the same host they logged in from; only the
   * PATH from this value is used. The IdP must allow the resulting URL.
   */
  postLogoutRedirectUri: string;

  /** OIDC scopes requested during login. */
  scopes: string;

  /** Secret used to sign the local session cookie. */
  sessionSecret: string;

  /** Session cookie name. */
  cookieName: string;

  /**
   * Whether the session cookie is marked `Secure` (sent over HTTPS only). Computed:
   * an explicit `OIDC_COOKIE_SECURE` wins; otherwise `NODE_ENV=production` forces true
   * whatever the redirect URI says, so a mistyped `OIDC_REDIRECT_URI` cannot quietly
   * downgrade the cookie; outside production it is inferred from the redirect URI scheme
   * so plain-HTTP local development works.
   */
  cookieSecure: boolean;

  /** Session lifetime in milliseconds. */
  sessionMaxAgeMs: number;

  /**
   * Email domains allowed to log in, lowercased. Empty means "do not filter by domain".
   * Checked together with {@link allowedEmails}: a login passes when the address is in
   * that list OR its domain is in this one.
   */
  allowedEmailDomains: string[];

  /**
   * Individual email addresses allowed to log in, lowercased. Empty means "do not filter
   * by address". Setting either this or {@link allowedEmailDomains} also makes an email
   * claim mandatory, so a provider that returns no email can no longer log anyone in.
   */
  allowedEmails: string[];

  /** Claim name carrying the caller's group memberships (default `groups`). */
  groupsClaim: string;

  /** Claim name carrying the caller's roles (default `roles`); unioned into `groups`. */
  rolesClaim: string;

  /**
   * Lowercased group names that mark a caller as a platform operator. A caller is
   * a platform operator iff their groups intersect this set. Empty by default, so
   * nobody is a platform operator until configured (fail-closed). Sourced from
   * `OPENCRANE_PLATFORM_OPERATOR_GROUPS`.
   *
   * TODO: superseded once OpenCrane gains a first-class role model — this is the
   * non-presumptuous, config-driven stopgap, not a role system.
   */
  platformOperatorGroups: string[];

  /**
   * Lowercased group names that mark a caller as an organisation admin — the role
   * that may curate the MCP catalogue / manage an organisation they own. A caller
   * is an org admin iff their groups intersect this set (platform operators are
   * always org admins, being a superset). Empty by default, so nobody is an org
   * admin until configured (fail-closed). Sourced from `OPENCRANE_ORG_ADMIN_GROUPS`.
   */
  orgAdminGroups: string[];

  /**
   * Lowercased, trimmed per-cluster seed email that bootstraps the FIRST platform
   * operator before any IdP group/role mapping exists. A caller is a platform operator
   * if their **verified** email equals this value (compared case-insensitively + trimmed),
   * which is OR-ed with the group-based check in {@link platformOperatorGroups} — seed
   * OR group ⇒ operator.
   *
   * Empty by default, so the seed grants operator to NOBODY until a platform admin sets
   * it at install (fail-closed). It is a per-cluster INSTALL parameter — never hardcoded —
   * sourced from `OPENCRANE_PLATFORM_OPERATOR_SEED_EMAIL`.
   *
   * TODO: superseded once OpenCrane gains a first-class role model — this is the
   * non-presumptuous, config-driven bootstrap, not a role system.
   */
  platformOperatorSeedEmail: string;
}
