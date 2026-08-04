/**
 * Authenticated, silo-scoped human principal derived from server-owned request facts.
 *
 * This shape deliberately contains no backend-domain caller type. Each capability maps these
 * identity facts to the caller vocabulary it owns.
 */
export interface RequestPrincipal
{
  /** Stable identity-provider subject, or the normalised email fallback. */
  subjectId: string;

  /** Silo selected by the trusted request host. */
  siloId: string;

  /** Whether the authenticated session carries organisation-administrator authority. */
  isOrgAdmin: boolean;
}
