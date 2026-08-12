/**
 * The three configured values that decide who may become a standalone silo's owner: which silo,
 * which verified email, and which OIDC issuer. Read from the environment at startup, so a login can
 * never widen its own eligibility.
 */
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

/**
 * The owner claim handed to persistence once the login's host, issuer, and subject have checked out.
 *
 * `mayCreateOwner` is the one permission left: it is true only when the login's verified email
 * matched the configured one, and it decides whether an empty owner slot may be filled.
 */
export interface StandaloneFirstUserOwnerClaim
{
  /** Silo in which the one-time owner claim is being made. */
  readonly clusterTenant: string;
  /** Stable OIDC subject that will own the silo. */
  readonly subject: string;
  /** Whether this callback may create an unclaimed owner slot after verified email matching. */
  readonly mayCreateOwner: boolean;
}

/**
 * How a first-owner claim ended. Only `Admitted` and `AlreadyOwner` let the caller proceed.
 *
 * A standalone silo has exactly one owner slot and every login tries to fill it, so two logins can
 * race for the same empty slot: both see it empty, both insert, and the unique constraint lets only
 * one through. The loser retries and comes back with `AlreadyOwner` when it is the same subject, or
 * `AlreadyClaimed` when someone else got there first. `AlreadyClaimed` also covers a subject whose
 * membership exists but is not an active Owner, so a demoted or suspended user cannot promote itself
 * back. `NotEligible` is different in kind: the login did not match the configured host, issuer, or
 * verified email, so it was never a candidate. Both refusals make the login fail visibly in the
 * browser instead of dropping the user into a silo they do not own.
 *
 * @see StandaloneFirstUserAdmissionResult
 */
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

/**
 * Claims the silo's single owner slot, all or nothing.
 *
 * The implementation opens a serializable transaction and retries once if it collides with a
 * concurrent login, so callers get a settled outcome and never handle the race themselves.
 *
 * Called by: _AdmitStandaloneFirstUser in this package; implemented by
 * {@link PrismaStandaloneFirstUserAdmissionUnitOfWork}.
 */
export interface StandaloneFirstUserAdmissionRepository
{
  /**
   * @param claim - Silo, subject, and whether this login may create the owner row.
   * @returns One of the four outcomes; only `Admitted` means this call created the owner.
   */
  claimOwner(claim: StandaloneFirstUserOwnerClaim): Promise<StandaloneFirstUserAdmissionResult>;
}

/**
 * Marks the implementation that opens the transaction, as opposed to one that joins an existing one.
 * It adds no methods; the only distinction is which layer may start a transaction.
 */
export interface StandaloneFirstUserAdmissionUnitOfWork extends StandaloneFirstUserAdmissionRepository
{
}

/** Audit boundary supplied by composition so identity records a claim inside its selected transaction. */
export interface StandaloneFirstUserAdmissionAuditPort
{
  /** Appends immutable first-owner evidence through the exact owner-claim transaction. */
  append(transaction: unknown, claim: Pick<StandaloneFirstUserOwnerClaim, "clusterTenant" | "subject">): Promise<void>;
}

/**
 * The reads and writes one owner-slot decision needs, all against a single open transaction.
 *
 * Called by: _ClaimStandaloneFirstUserOwner in this package; implemented by
 * {@link PrismaStandaloneFirstUserAdmissionRepository}.
 */
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
