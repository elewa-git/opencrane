/**
 * One owner or administrator label shown in the authenticated user's organisation summary.
 *
 * This row is presentation data, not authorization evidence. A protected route must ask
 * `AuthorizationAuthority` even when this summary contains the organisation.
 */
export interface OwnedOrgSummaryRow
{
  /** The organisation (ClusterTenant) key. */
  clusterTenant: string;

  /** The membership label shown beside the organisation. */
  role: "Owner" | "Admin";
}

/**
 * Supplies the membership labels that {@link _ResolveOwnedOrgSummaries} presents.
 *
 * Implementations may filter roles for display but cannot grant permission. Database failures must
 * remain errors so `/auth/me` does not return a successful but incomplete organisation summary.
 *
 * Implemented by: {@link PrismaOwnedOrgSummaryRepository} (./prisma-owned-org-summary-repository.ts),
 * and by hand-written stubs in ./__tests__.
 * Called by: {@link _ResolveOwnedOrgSummaries}; the instance is handed to
 * `OidcAuthServiceBase` at construction (see
 * libs/backend/server/iam/identity/main/src/auth/oidc.service.ts).
 */
export interface OwnedOrgSummaryRepository
{
  /**
   * Fetch the caller's owner and administrator labels for presentation.
   *
   * @param subject - The subject the identity provider verified (OIDC `sub`), already
   *                  trimmed by the caller.
   * @returns The matching display rows, or an empty list when there is nothing to present.
   * @throws When the lookup cannot be performed.
   */
  findOwnedOrgSummaries(subject: string): Promise<readonly OwnedOrgSummaryRow[]>;
}

/** One organisation shown as owned or administered in the authenticated session summary. */
export interface OwnedOrg
{
  /** The organisation (ClusterTenant) key. */
  clusterTenant: string;

  /** The owner or administrator label shown in the user interface. */
  role: "owner" | "admin";
}

/** The caller's organisation-membership presentation rows. */
export interface OwnedOrgSummaryFacts
{
  /**
   * The organisations shown as owned or administered. The list grants no product permission;
   * members are omitted because this field is a compact presentation summary.
   */
  ownedOrgs: OwnedOrg[];
}
