import type { OrgMembershipFacts, OrgMembershipRepository, OwnedOrg } from "./org-membership.types.js";

export type { OrgMembershipFacts, OrgMembershipRepository, OrgMembershipRow, OwnedOrg } from "./org-membership.types.js";

/** Empty (fail-closed) facts: no admin authority, no org scope. */
const _EMPTY: OrgMembershipFacts = { isOrgAdmin: false, ownedOrgs: [] };

/**
 * Resolve the caller's org-admin facts from their `OrgMembership` rows, fail-closed.
 *
 * This is the single membership derivation used by OIDC session introspection:
 *
 *   - A subject who holds `owner` or `admin` on ≥1 org IS an org admin, scoped to
 *     exactly those orgs.
 *   - `member` rows confer no admin authority and are excluded from the scope.
 *   - A missing subject or no rows ⇒ empty facts (no authority).
 *   - A lookup failure propagates so the caller cannot mistake an unavailable authority source
 *     for a successful empty membership result.
 *
 * Keyed on the IdP-verified subject (OIDC `sub`), never request input.
 *
 * @param repository - Repository providing the membership rows.
 * @param subject - The caller's IdP-verified subject; empty/undefined ⇒ empty facts.
 * @returns The derived org-admin flag and the owned/administered org set.
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

  return { isOrgAdmin: ownedOrgs.length > 0, ownedOrgs };
}
