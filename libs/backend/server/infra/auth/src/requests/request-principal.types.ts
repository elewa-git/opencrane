/**
 * Authenticated, silo-scoped human principal derived from server-owned request facts.
 *
 * This shape deliberately contains no backend-domain caller type. Each capability maps these
 * identity facts to the caller vocabulary it owns.
 */
export interface RequestPrincipal
{
  /** Stable local Principal ID attached after exact identity projection. */
  principalId: string;

  /** Stable external OIDC subject retained for authorities not yet projected to Principal IDs. */
  externalSubject: string;

  /** Verified OIDC issuer that namespaces the external subject. */
  externalIssuer: string;

  /** Silo selected by the trusted request host. */
  siloId: string;

  /** Server-verified OIDC authentication instant, or null for invalid legacy session data. */
  verifiedAuthenticationAt: Date | null;
}
