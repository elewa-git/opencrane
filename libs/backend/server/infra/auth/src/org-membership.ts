import type { OrgMembershipFacts, OrgMembershipRepository, OwnedOrg } from "./org-membership.types";

export type { OrgMembershipFacts, OrgMembershipRepository, OrgMembershipRow, OwnedOrg } from "./org-membership.types";

/** Empty presentation facts for a caller with no administering membership rows. */
const _EMPTY: OrgMembershipFacts = { ownedOrgs: [] };

/**
 * List the organisations the caller owns or administers for session presentation.
 *
 * The rules:
 *   - Holding `owner` or `admin` on at least one organisation makes the caller an org
 *     admin, for exactly those organisations.
 *   - `member` rows grant nothing and never appear in the returned list.
 *   - No subject, or no rows, means no authority.
 *   - A failed lookup is RETHROWN, never turned into an empty result. This matters: an
 *     unreachable database would otherwise silently read as "administers nothing", and a
 *     caller would strip a real admin's rights instead of reporting an error.
 *
 * Always keyed on the subject the identity provider verified (OIDC `sub`), never on
 * anything from the request body or query.
 *
 * Called by: `OidcAuthServiceBase.getStatus` in ./oidc-service.ts, on every `/auth/me`.
 *
 * @param repository - Supplies the owner/admin rows; see {@link OrgMembershipRepository}.
 * @param subject    - The caller's verified subject; empty or missing returns no authority.
 * @returns The organisations the caller owns or administers.
 * @throws Whatever the repository throws when the lookup fails — deliberately not caught.
 */
export async function _ResolveOrgMembershipFacts(repository: OrgMembershipRepository, subject: string | undefined): Promise<OrgMembershipFacts>
{
  const normalized = typeof subject === "string" ? subject.trim() : "";
  if (!normalized)
  {
    return _EMPTY;
  }

  const rows = await repository.findAdminMemberships(normalized);

  const ownedOrgs: OwnedOrg[] = rows.map(function _toOwned(row)
  {
    return { clusterTenant: row.clusterTenant, role: row.role === "Owner" ? "owner" : "admin" };
  });

  return { ownedOrgs };
}
