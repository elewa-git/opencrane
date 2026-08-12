/**
 * One `OrgMembership` row, cut down to just what {@link _ResolveOrgMembershipFacts} needs.
 *
 * The repository has already filtered to owner and admin rows for one verified subject, so
 * every row here carries authority — there is no "is this role high enough" check left for
 * the reader to do. {@link PrismaOrgMembershipRepository} throws rather than return a row
 * with any other role.
 */
export interface OrgMembershipRow
{
  /** The organisation (ClusterTenant) key. */
  clusterTenant: string;

  /** The authority-bearing membership role returned by the repository. */
  role: "Owner" | "Admin";
}

/**
 * Supplies the membership rows that {@link _ResolveOrgMembershipFacts} reasons about.
 *
 * The split is deliberate: this interface only fetches rows from storage, and the resolver
 * decides what they mean. Anything implementing it must therefore not filter further,
 * reorder meaningfully, or swallow errors — an implementation that returned an empty list
 * on a database error would silently strip an admin's rights.
 *
 * Implemented by: {@link PrismaOrgMembershipRepository} (./prisma-org-membership-repository.ts),
 * and by hand-written stubs in ./__tests__.
 * Called by: {@link _ResolveOrgMembershipFacts}; the instance is handed to
 * `OidcAuthServiceBase` at construction (see
 * libs/backend/server/iam/identity/main/src/oidc.service.ts line 56).
 */
export interface OrgMembershipRepository
{
  /**
   * Fetch the caller's owner and admin memberships. `member` rows must not be returned.
   *
   * @param subject - The subject the identity provider verified (OIDC `sub`), already
   *                  trimmed by the caller.
   * @returns The matching rows, or an empty list when the subject administers nothing.
   *          An empty list must mean exactly that — never "the lookup failed".
   * @throws When the lookup cannot be performed. Throwing is required: the resolver
   *         deliberately lets it propagate so an outage is never read as "no memberships".
   */
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
