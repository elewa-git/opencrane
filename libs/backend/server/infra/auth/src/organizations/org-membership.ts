import type { OwnedOrgSummaryFacts, OwnedOrgSummaryRepository, OwnedOrg } from "./org-membership.types";

export type { OwnedOrgSummaryFacts, OwnedOrgSummaryRepository, OwnedOrgSummaryRow, OwnedOrg } from "./org-membership.types";

/** Returns an empty presentation when the verified subject owns or administers no organisation. */
const _EMPTY: OwnedOrgSummaryFacts = { ownedOrgs: [] };

/**
 * List the organisations the caller owns or administers for session presentation.
 *
 * This function supplies a navigation and account summary only. It grants no product permission;
 * routes use `AuthorizationAuthority` even when an owner or administrator label appears here.
 * Missing subjects return an empty summary, while database failures remain errors so the API does
 * not present incomplete organisation data as a successful response.
 *
 * Always keyed on the subject the identity provider verified (OIDC `sub`), never on
 * anything from the request body or query.
 *
 * Called by: `OidcAuthServiceBase.getStatus` in ./oidc-service.ts, on every `/auth/me`.
 *
 * @param repository - Supplies the owner/admin rows; see {@link OwnedOrgSummaryRepository}.
 * @param subject - The caller's verified subject; empty or missing values return no summaries.
 * @returns The organisations shown as owned or administered in the caller's session summary.
 * @throws Whatever the repository throws when the lookup fails — deliberately not caught.
 */
export async function _ResolveOwnedOrgSummaries(repository: OwnedOrgSummaryRepository, subject: string | undefined): Promise<OwnedOrgSummaryFacts>
{
  const normalized = typeof subject === "string" ? subject.trim() : "";
  if (!normalized)
  {
    return _EMPTY;
  }

  const rows = await repository.findOwnedOrgSummaries(normalized);

  const ownedOrgs: OwnedOrg[] = rows.map(function _ToOwnedOrg(row)
  {
    return { clusterTenant: row.clusterTenant, role: row.role === "Owner" ? "owner" : "admin" };
  });

  return { ownedOrgs };
}
