/**
 * Identifies the local Principal matched to a verified silo, issuer, and subject.
 * MCP and resource-sharing caller resolvers use this result instead of treating session claims as
 * product authority.
 */
export interface AuthenticatedPrincipal
{
  /** Matches the silo stored on the resolved Principal. */
  siloId: string;
  /** Identifies the Principal that product authorization and ownership use. */
  principalId: string;
}

/**
 * Maps a server-verified silo, issuer, and subject to a stored Principal.
 * MCP and resource-sharing routes deny the request when this port returns `null`, so an
 * implementation must never fall back to session claims.
 */
export interface AuthenticatedPrincipalDirectory
{
  /**
   * Looks up the Principal whose stored identity matches all three verified coordinates.
   * The silo and issuer match prevent the same subject value from another authority from becoming
   * local product authority.
   *
   * Called by: MCP and resource-sharing caller resolvers, authenticated Principal admission and
   * capability transactions, and `Tier3DevelopmentAuthService`.
   * @param siloId - Silo derived from the trusted request host or startup-selected development host.
   * @param issuer - Authentication authority that verified the subject.
   * @param subject - Subject identifier issued by that authority.
   * @returns The matched Principal, or `null` when the stored projection cannot prove the tuple.
   * @throws When the backing identity store is unavailable.
   */
  resolveAuthenticatedPrincipal(siloId: string, issuer: string, subject: string): Promise<AuthenticatedPrincipal | null>;
}
