/**
 * Types for the fleet → silo OrgMembership projection repairer (#126 S2).
 */

/**
 * The application-owned callbacks the repairer needs to enforce a suspension.
 * Injected ports prevent projection and tenant domains from importing each other.
 */
export interface MembershipEnforcementDeps
{
  /** Namespace this silo's Tenant CRs live in (the projection-repair namespace). */
  namespace: string;
  /** Force-delete the member's runtime pod before suspension. */
  cutTenant(tenant: string, namespace: string, reason: string): Promise<void>;
  /** Persist the suspension state on the member's Tenant resource. */
  setTenantSuspended(tenant: string, suspended: boolean): Promise<void>;
}

/** A single membership as returned by the fleet internal endpoint. */
export interface FleetMembershipRow
{
  /** IdP-verified subject (OIDC `sub`) holding the membership. */
  subject: string;
  /** Role held within the org (Owner | Admin | Member). */
  role: string;
  /** Lifecycle status (Active | Suspended); absent/unknown on the wire ⇒ treated as Active. */
  status?: string;
}

/**
 * Reader over the fleet's authoritative org membership. The default HTTP implementation
 * pulls from the fleet internal endpoint; tests inject a fake. A reader returns `null`
 * to signal "source unavailable" (unconfigured / unreachable / non-OK), which the
 * repairer treats as a safe no-op — it never wipes the local rows on an empty read it
 * cannot trust.
 */
export interface FleetMembershipReader
{
  /**
   * Read the org's authoritative memberships from the fleet, or null when the source
   * is unavailable (so the repairer no-ops rather than deleting local rows).
   *
   * @param clusterTenant - The org (ClusterTenant) whose membership to read.
   */
  read(clusterTenant: string): Promise<FleetMembershipRow[] | null>;
}

/** Writes member adoptions through to the fleet authority. */
export interface FleetMembershipWriter
{
  /**
   * Adopt a member into the org without downgrading an existing membership.
   *
   * @param clusterTenant - The org receiving the member.
   * @param subject - The identity-provider subject to adopt.
   * @returns True when the fleet accepted the write.
   */
  adopt(clusterTenant: string, subject: string): Promise<boolean>;
}
