/**
 * The two facts recorded when a silo's first owner is admitted.
 *
 * It is its own small type so identity and audit can agree on the shape without importing each
 * other; identity's StandaloneFirstUserAdmissionAuditPort takes the same fields.
 */
export interface StandaloneFirstUserAuditClaim
{
  /** Silo whose one-time owner row was admitted. */
  readonly clusterTenant: string;
  /** Stable authentication-authority subject admitted as that silo's first owner. */
  readonly subject: string;
}

/**
 * Writes the first-owner audit row inside the transaction that claims the owner slot.
 *
 * The transaction arrives as `unknown` on purpose: identity owns it, and this package must not
 * depend on identity's Prisma types. The implementation casts it back to a transaction client.
 *
 * Called by: apps/opencrane/src/app/public-app.ts supplies
 * {@link __CreateStandaloneFirstUserAdmissionAuditAppender} as the implementation; identity calls
 * `append` from its owner-claim repository.
 */
export interface StandaloneFirstUserAdmissionAuditAppender
{
  /**
   * @param transaction - Identity's open serializable transaction, passed as an opaque value.
   * @param claim - Silo and subject being admitted as owner.
   * @throws Error from the insert, which rolls the owner claim back rather than leaving it unaudited.
   */
  append(transaction: unknown, claim: StandaloneFirstUserAuditClaim): Promise<void>;
}
