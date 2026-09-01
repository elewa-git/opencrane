/**
 * Turn the identity provider's group and role claims into the identity facts stored on the
 * session: the caller's `groups` and the derived `isPlatformOperator` identity-plane claim.
 *
 * The rules, all fail-closed (an unset allowlist grants the role to nobody):
 *   - `groups` is the union of the configured groups claim and the configured roles claim,
 *     because Zitadel reports group memberships under one and application roles under the
 *     other, and either may grant a role.
 *   - Platform operator when one of those names is in the configured operator group list,
 *     OR the caller's VERIFIED email equals the per-cluster seed email.
 *
 * Does no I/O, so these rules can be tested without running a login.
 *
 * `clusterTenant` is deliberately NOT derived here: the identity domain resolves it
 * server-side from the verified email, never from a claim the caller could assert.
 *
 * Called by: `OidcAuthServiceBase._buildAuthUser` in ./oidc-service.ts — the only caller.
 *
 * TODO: a stopgap until OpenCrane has a real role model, which will replace
 * `isPlatformOperator`.
 *
 * @param claims        - The merged ID-token and UserInfo claims for the caller.
 * @param config        - Supplies the two claim names, the operator allowlist, and the seed email.
 * @param verifiedEmail - The caller's email ONLY when the provider marked it verified
 *                        (lowercased and trimmed). Absent for an unverified email, which
 *                        is how an unverified address is prevented from matching the seed.
 * @returns The group names found and the derived platform-operator identity claim.
 * @see https://zitadel.com/docs/apis/openidoauth/scopes — how Zitadel emits group and
 *      role claims, which is why both claims are read and unioned.
 */
export function _ResolveIdentityClaims(
  claims: Record<string, unknown>,
  config: { groupsClaim: string; rolesClaim: string; platformOperatorGroups: string[]; platformOperatorSeedEmail: string },
  verifiedEmail?: string,
): { groups: string[]; isPlatformOperator: boolean }
{
  // 1. Collect the raw values from both the groups and roles claims — Zitadel emits
  //    group memberships under the configured `groups` claim and project/app roles
  //    under `roles`; either may grant operator status, so the union is what we
  //    authorize against. Claim names are install-configurable via OIDC_GROUPS_CLAIM
  //    / OIDC_ROLES_CLAIM.
  const groups = [..._ReadStringArrayClaim(claims[config.groupsClaim]), ..._ReadStringArrayClaim(claims[config.rolesClaim])];
  const lowered = groups.map(value => value.toLowerCase());

  // 2. Operator via group: an empty operator set means nobody qualifies — fail-closed.
  const operatorSet = new Set(config.platformOperatorGroups);
  const operatorViaGroup = operatorSet.size > 0 && lowered.some(value => operatorSet.has(value));

  // 3. Operator via seed: the per-cluster bootstrap. True iff a non-empty seed equals the
  //    caller's VERIFIED email (already lowercased/trimmed). An empty seed grants operator
  //    to nobody (fail-closed); an unverified email never reaches `verifiedEmail`, so it can
  //    never match. This is ADDITIVE to the group check — seed OR group ⇒ operator.
  const seed = config.platformOperatorSeedEmail.trim().toLowerCase();
  const operatorViaSeed = seed !== "" && typeof verifiedEmail === "string" && verifiedEmail.trim().toLowerCase() === seed;

  const isPlatformOperator = operatorViaGroup || operatorViaSeed;

  return { groups, isPlatformOperator };
}

/**
 * Read a group or role claim as a list of names.
 *
 * Providers send these claims either as an array of strings or as a single string, so
 * both are accepted; blank entries are dropped and entries are trimmed. Any other shape
 * (a number, an object, null) yields an empty list rather than an error, so one oddly
 * shaped claim cannot break a login — it just grants no roles.
 *
 * Called by: {@link _ResolveIdentityClaims} in this file. Exported through the package
 * barrel; no other caller in this repo.
 *
 * @param value - The raw claim value, straight off the claims object.
 * @returns The names found, in claim order; empty when the claim is missing or not a
 *          string or array of strings.
 */
export function _ReadStringArrayClaim(value: unknown): string[]
{
  if (Array.isArray(value))
  {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  }

  if (typeof value === "string" && value.trim() !== "")
  {
    return [value.trim()];
  }

  return [];
}
