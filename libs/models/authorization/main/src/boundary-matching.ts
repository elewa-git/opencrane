import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, type AuthorizationBoundary, type AuthorizationBoundaryContext } from "./authorization-boundary.types";

/**
 * Determines whether one grant covers the requested boundary using hierarchy evidence loaded from storage.
 *
 * A personal boundary is never hierarchical. A group with descendant coverage matches itself and any
 * requested group whose persisted ancestor path contains the granted group. Callers must not build the
 * ancestor path from login claims or request data.
 *
 * Called by: `./authorization-decision.ts`.
 * @param grantedBoundary - Boundary stored with the grant.
 * @param coverage - Coverage stored with the grant.
 * @param requestedBoundary - Boundary targeted by the action.
 * @param context - Group ancestry loaded from product authority for this request.
 * @returns True when the stored grant covers the requested boundary.
 */
export function __AuthorizationBoundaryCovers(
	grantedBoundary: AuthorizationBoundary,
	coverage: AuthorizationBoundaryCoverages,
	requestedBoundary: AuthorizationBoundary,
	context: AuthorizationBoundaryContext,
): boolean
{
	if (grantedBoundary.kind !== requestedBoundary.kind)
	{
		return false;
	}

	if (grantedBoundary.kind === AuthorizationBoundaryKinds.Personal)
	{
		return coverage === AuthorizationBoundaryCoverages.Exact
			&& requestedBoundary.kind === AuthorizationBoundaryKinds.Personal
			&& grantedBoundary.principalId === requestedBoundary.principalId;
	}

	if (requestedBoundary.kind !== AuthorizationBoundaryKinds.Group)
	{
		return false;
	}

	if (grantedBoundary.groupId === requestedBoundary.groupId)
	{
		return true;
	}

	return coverage === AuthorizationBoundaryCoverages.Descendants
		&& context.requestedGroupAncestorIds.includes(grantedBoundary.groupId);
}

/**
 * Determines whether two boundaries identify the same stored node.
 * @param firstBoundary - First boundary to compare.
 * @param secondBoundary - Second boundary to compare.
 * @returns True when both boundaries have the same kind and identifier.
 */
export function __AuthorizationBoundariesEqual(
	firstBoundary: AuthorizationBoundary,
	secondBoundary: AuthorizationBoundary,
): boolean
{
	if (firstBoundary.kind !== secondBoundary.kind)
	{
		return false;
	}

	if (firstBoundary.kind === AuthorizationBoundaryKinds.Group)
	{
		return secondBoundary.kind === AuthorizationBoundaryKinds.Group
			&& firstBoundary.groupId === secondBoundary.groupId;
	}

	return secondBoundary.kind === AuthorizationBoundaryKinds.Personal
		&& firstBoundary.principalId === secondBoundary.principalId;
}
