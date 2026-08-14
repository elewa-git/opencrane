import type { AuthorizationScope } from "./authorization-scope.types";

/**
 * Determines whether a grant's scope is broad enough to cover a requested scope.
 *
 * Only one widening exists: an organization-wide grant covers every scope in the same
 * organization. Every other scope kind — department, team, project, personal, direct-user —
 * matches only the identical kind and identifier. A team grant does NOT cover a project in that
 * team, and a department grant does NOT cover its teams; those need their own grants.
 * @param grantedScope - Scope carried by the grant.
 * @param requestedScope - Scope the request targets.
 * @returns True only when the granted scope covers the requested one.
 * @see {@link AuthorizationScope}
 */
export function __AuthorizationScopeCovers(
	grantedScope: AuthorizationScope,
	requestedScope: AuthorizationScope,
): boolean
{
	if (grantedScope.organizationId !== requestedScope.organizationId)
	{
		return false;
	}

	if (grantedScope.kind === "organization")
	{
		return true;
	}

	if (grantedScope.kind !== requestedScope.kind)
	{
		return false;
	}

	switch (grantedScope.kind)
	{
		case "department":
			return requestedScope.kind === "department"
				&& grantedScope.departmentId === requestedScope.departmentId;
		case "team":
			return requestedScope.kind === "team"
				&& grantedScope.teamId === requestedScope.teamId;
		case "project":
			return requestedScope.kind === "project"
				&& grantedScope.projectId === requestedScope.projectId;
		case "personal":
			return requestedScope.kind === "personal"
				&& grantedScope.userId === requestedScope.userId;
		case "direct-user":
			return requestedScope.kind === "direct-user"
				&& grantedScope.userId === requestedScope.userId;
	}
}

/**
 * Determines whether two authorization scopes identify the exact same dimension.
 * @param firstScope - First scope to compare.
 * @param secondScope - Second scope to compare.
 * @returns Whether both scopes are identical.
 */
export function __AuthorizationScopesEqual(
	firstScope: AuthorizationScope,
	secondScope: AuthorizationScope,
): boolean
{
	return __AuthorizationScopeCovers(firstScope, secondScope)
		&& __AuthorizationScopeCovers(secondScope, firstScope);
}
