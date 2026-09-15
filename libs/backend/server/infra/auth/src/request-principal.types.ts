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

  /** Stable external identity subject retained for authorities not yet projected to Principal IDs. */
  externalSubject: string;

  /** Deployment-trusted identity issuer that namespaces the external subject. */
  externalIssuer: string;

  /** Silo selected by the trusted request host. */
  siloId: string;

  /** Server-verified authentication instant, or null for invalid session data. */
  verifiedAuthenticationAt: Date | null;
}
