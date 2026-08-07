import type { AuthorizationScope } from "./authorization-scope.types.js";

/**
 * Determines whether a grant scope covers a requested scope.
 * Organization scope covers every dimension in the same organization; all
 * narrower dimensions match only their own kind and identifier.
 * @param grantedScope - Scope carried by the grant.
 * @param requestedScope - Scope targeted by the request.
 * @returns Whether the grant covers the requested scope.
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
