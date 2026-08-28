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

  /** Stable authority subject retained alongside the projected Principal ID. */
  externalSubject: string;

  /** Verified issuer that namespaces the authority subject. */
  externalIssuer: string;

  /** Silo selected by the trusted request host. */
  siloId: string;

  /** Whether the authenticated session carries organisation-administrator authority. */
  isOrgAdmin: boolean;

  /** Server-verified authentication instant, or null for invalid session data. */
  verifiedAuthenticationAt: Date | null;
}
