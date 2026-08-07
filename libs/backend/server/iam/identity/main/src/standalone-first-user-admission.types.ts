/** Deployment-owned bootstrap coordinates for exactly one standalone-silo owner. */
export interface StandaloneFirstUserAdmissionConfig
{
  /** ClusterTenant served by this release and derived again from the callback host. */
  readonly clusterTenant: string;
  /** Verified OIDC email that is eligible to claim the first owner membership. */
  readonly email: string;
  /** Immutable OIDC issuer expected to authenticate this standalone owner's subject. */
  readonly issuer: string;
}

/** Trusted OIDC and request facts considered by standalone first-user admission. */
export interface StandaloneFirstUserAdmissionCommand
{
  /** ClusterTenant derived from the request host, never from a browser payload. */
  readonly hostClusterTenant: string | null | undefined;
  /** Issuer that authenticated the OIDC subject. */
  readonly issuer: string;
  /** Stable OIDC subject that becomes the durable membership key. */
  readonly subject: string;
  /** OIDC email claim normalized by the authenticated session boundary. */
  readonly email: string | undefined;
  /** Explicit proof that the identity provider verified the email claim. */
  readonly emailVerified: boolean | undefined;
}

/** Durable owner-claim request after all trusted admission checks have passed. */
export interface StandaloneFirstUserOwnerClaim
{
  /** Silo in which the one-time owner claim is being made. */
  readonly clusterTenant: string;
  /** Stable OIDC subject that will own the silo. */
  readonly subject: string;
  /** Whether this callback may create an unclaimed owner slot after verified email matching. */
  readonly mayCreateOwner: boolean;
}

/** Stable outcomes of the standalone first-owner admission decision. */
export enum StandaloneFirstUserAdmissionOutcomes
{
  /** The configured verified user was created as this silo's active owner. */
  Admitted = "admitted",
  /** The same subject already owns this silo, so the claim is safely idempotent. */
  AlreadyOwner = "already_owner",
  /** Trusted callback facts do not satisfy this silo's configured bootstrap contract. */
  NotEligible = "not_eligible",
  /** A different or non-active owner membership already occupies the one-owner slot. */
  AlreadyClaimed = "already_claimed",
}

/** Result of checking and, when eligible, claiming standalone first-owner authority. */
export interface StandaloneFirstUserAdmissionResult
{
  /** The durable admission outcome; only admitted and already_owner confer first-owner status. */
  readonly outcome: StandaloneFirstUserAdmissionOutcomes;
}

/** Persistence port that atomically claims the single owner slot for one standalone silo. */
export interface StandaloneFirstUserAdmissionRepository
{
  /** Claims one owner membership or returns an idempotent/denied durable outcome. */
  claimOwner(claim: StandaloneFirstUserOwnerClaim): Promise<StandaloneFirstUserAdmissionResult>;
}

/** Unit-of-work port that owns the serializable standalone first-owner transaction. */
export interface StandaloneFirstUserAdmissionUnitOfWork extends StandaloneFirstUserAdmissionRepository
{
}

/** Audit boundary supplied by composition so identity records a claim inside its selected transaction. */
export interface StandaloneFirstUserAdmissionAuditPort
{
  /** Appends immutable first-owner evidence through the exact owner-claim transaction. */
  append(transaction: unknown, claim: Pick<StandaloneFirstUserOwnerClaim, "clusterTenant" | "subject">): Promise<void>;
}

/** Transaction-scoped persistence operations needed to inspect and claim one owner slot. */
export interface StandaloneFirstUserOwnerClaimRepository
{
  /** Finds the exact subject membership inside the selected silo. */
  findMembership(claim: StandaloneFirstUserOwnerClaim): Promise<StandaloneFirstUserStoredMembership | null>;
  /** Finds the sole existing owner membership for the selected silo. */
  findOwner(clusterTenant: string): Promise<StandaloneFirstUserStoredMembership | null>;
  /** Creates the active Owner membership for a previously unclaimed silo. */
  createOwner(claim: StandaloneFirstUserOwnerClaim): Promise<void>;
  /** Appends immutable evidence for an Owner membership created by this exact transaction. */
  appendOwnerAdmissionAudit(claim: StandaloneFirstUserOwnerClaim): Promise<void>;
}

/** Minimum stored membership facts that decide whether a one-time claim is idempotent. */
export interface StandaloneFirstUserStoredMembership
{
  /** Subject that owns or otherwise occupies the selected membership tuple. */
  readonly subject: string;
  /** Persisted membership role serialized by the authoritative Prisma enum. */
  readonly role: "Owner" | "Admin" | "Member";
  /** Whether this stored membership remains active. */
  readonly status: "Active" | "Suspended";
}
