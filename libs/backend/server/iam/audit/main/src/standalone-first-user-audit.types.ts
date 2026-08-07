/** Structural input shared with the identity admission port without introducing an IAM cycle. */
export interface StandaloneFirstUserAuditClaim
{
  /** Silo whose one-time owner row was admitted. */
  readonly clusterTenant: string;
  /** OIDC subject admitted as that silo's first owner. */
  readonly subject: string;
}

/** Audit adapter interface supplied by the OpenCrane composition root to identity admission. */
export interface StandaloneFirstUserAdmissionAuditAppender
{
  /** Records first-owner evidence inside identity's active serializable transaction. */
  append(transaction: unknown, claim: StandaloneFirstUserAuditClaim): Promise<void>;
}
