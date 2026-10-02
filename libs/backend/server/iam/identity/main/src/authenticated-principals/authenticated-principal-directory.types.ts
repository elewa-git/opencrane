/** Stable product identity resolved from one deployment-trusted external identity. */
export interface AuthenticatedPrincipal
{
  /** Silo selected independently from the trusted request host. */
  siloId: string;
  /** Stable product principal used by authorization and resource ownership. */
  principalId: string;
}

/** Resolves deployment-trusted identity coordinates to the exact local principal projection. */
export interface AuthenticatedPrincipalDirectory
{
  /**
   * Resolves exactly one issuer-and-subject pair inside the trusted silo.
   *
   * Called by: authenticated HTTP composition before domain commands receive an actor.
   * @see AuthenticatedPrincipal
   */
  resolveAuthenticatedPrincipal(siloId: string, issuer: string, subject: string): Promise<AuthenticatedPrincipal | null>;
}
