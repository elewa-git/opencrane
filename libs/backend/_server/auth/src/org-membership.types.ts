/**
 * Minimal row returned by the membership repository after it has restricted the durable query to
 * owner and administrator memberships for one verified subject.
 */
export interface OrgMembershipRow
{
  /** The organisation (ClusterTenant) key. */
  clusterTenant: string;

  /** The authority-bearing membership role returned by the repository. */
  role: "Owner" | "Admin";
}

/**
 * Repository authority for the membership facts resolver. The resolver owns the access rule;
 * this port owns only the durable lookup that supplies its rows.
 */
export interface OrgMembershipRepository
{
  /** Find owner/admin memberships for the verified caller subject. */
  findAdminMemberships(subject: string): Promise<readonly OrgMembershipRow[]>;
}

/** One organisation the caller administers, with the role they hold there. */
export interface OwnedOrg
{
  /** The organisation (ClusterTenant) key. */
  clusterTenant: string;

  /** The administering role the caller holds — `owner` or `admin`. */
  role: "owner" | "admin";
}

/**
 * The caller's membership-derived org-admin facts. Authority is derived purely
 * from `OrgMembership` rows, never from a global flag or a self-asserted claim.
 */
export interface OrgMembershipFacts
{
  /**
   * True iff the caller owns or administers at least one organisation — i.e. `ownedOrgs`
   * is non-empty. The membership-derived half of a session's `isOrgAdmin`.
   */
  isOrgAdmin: boolean;

  /**
   * The organisations the caller owns or administers (the org scope). Members
   * (role `member`) confer no admin authority and are excluded. Empty when the
   * caller administers no org.
   */
  ownedOrgs: OwnedOrg[];
}
